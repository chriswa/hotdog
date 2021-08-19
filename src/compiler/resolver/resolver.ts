import { BinarySyntaxNode, ClassDeclarationSyntaxNode, FunctionCallSyntaxNode, FunctionDefinitionSyntaxNode, GroupingSyntaxNode, IfStatementSyntaxNode, LiteralSyntaxNode, LogicShortCircuitSyntaxNode, ReturnStatementSyntaxNode, StatementBlockSyntaxNode, SyntaxNode, SyntaxNodeVisitor, TypeDeclarationSyntaxNode, UnarySyntaxNode, VariableAssignmentSyntaxNode, VariableLookupSyntaxNode, WhileStatementSyntaxNode } from "../syntax/syntax"
import { builtinsTypesByName } from "../../builtins/builtins"
import { ErrorWithSourcePos } from "../../ErrorWithSourcePos"
import { TokenType } from "../Token"
import { parse } from "../parser/parser"
import { CompileError } from "../CompileError"
import { ResolverOutput } from "./resolverOutput"
import { ResolverScope } from "./ResolverScope"
import { FunctionParameter } from "../syntax/FunctionParameter"
import { ClassType, InterfaceType, primitiveTypesMap } from "../../types"
import { mapMap } from "../../util"

interface IResolverResponse {
  ast: SyntaxNode;
  resolverOutput: ResolverOutput;
}

export function resolve(source: string, path: string): IResolverResponse {
  const ast = parse(source, path);
  const resolver = new Resolver();
  const resolverErrors = resolver.resolve(ast);
  if (resolverErrors.length > 0) {
    throw new CompileError(resolverErrors);
  }
  const resolverOutput = new ResolverOutput(resolver.scopesByNode);
  return { ast, resolverOutput };
}

class Resolver implements SyntaxNodeVisitor<void> {
  scope: ResolverScope;
  scopesByNode: Map<SyntaxNode, ResolverScope> = new Map();
  resolverErrors: Array<ErrorWithSourcePos> = [];
  constructor() {
    const topScope = new ResolverScope(null, false, null);
    topScope.preinitializeIdentifiers(builtinsTypesByName);
    topScope.preinitializeTypes(primitiveTypesMap);
    this.scope = topScope;
  }
  beginScope(isFunction: boolean, node: SyntaxNode, functionParameters: Array<FunctionParameter>) {
    const newScope = new ResolverScope(node, isFunction, this.scope);
    const preinitializedIdentifiers = new Map(functionParameters.map(parameter => [parameter.identifier.lexeme, newScope.resolveTypeAnnotation(parameter.typeAnnotation)]));
    newScope.preinitializeIdentifiers(preinitializedIdentifiers);
    this.scopesByNode.set(node, newScope);
    this.scope = newScope;
  }
  endScope() {
    if (this.scope.parentScope === null) {
      throw new Error("internal logic error: attempted to leave global scope");
    }
    this.scope = this.scope.parentScope;
  }

  generateResolverError(node: SyntaxNode, message: string) {
    const resolverError = new ErrorWithSourcePos("Resolver: " + message, node.referenceToken.path, node.referenceToken.charPos);
    this.resolverErrors.push(resolverError);
    return resolverError;
  }


  resolve(node: SyntaxNode): Array<ErrorWithSourcePos> {
    this.resolverErrors = [];
    this.resolveSyntaxNode(node);
    return this.resolverErrors;
  }

  resolveSyntaxNode(node: SyntaxNode) {
    node.accept(this);
  }
  resolveList(nodeList: Array<SyntaxNode>) {
    for (const node of nodeList) {
      this.resolveSyntaxNode(node);
    }
  }
  visitBinary(node: BinarySyntaxNode) {
    this.resolveSyntaxNode(node.left);
    this.resolveSyntaxNode(node.right);
  }
  visitUnary(node: UnarySyntaxNode) {
    this.resolveSyntaxNode(node.right);
  }
  visitLiteral(node: LiteralSyntaxNode) {
    // pass
  }
  visitGrouping(node: GroupingSyntaxNode) {
    this.resolveSyntaxNode(node.expr);
  }
  visitStatementBlock(node: StatementBlockSyntaxNode) {
    this.beginScope(false, node, []);
    this.resolveList(node.statementList);
    this.endScope();
  }
  visitIfStatement(node: IfStatementSyntaxNode) {
    this.resolveSyntaxNode(node.cond);
    this.resolveSyntaxNode(node.thenBranch);
    if (node.elseBranch !== null) {
      this.resolveSyntaxNode(node.elseBranch);
    }

    // late-const branch initialization feature
    const thenInitializedVars = this.scopesByNode.get(node.thenBranch)!.initializedVars;
    const elseInitializedVars: Set<string> = node.elseBranch !== null ? this.scopesByNode.get(node.elseBranch)!.initializedVars : new Set();
    const bothInitializedVars = new Set([...thenInitializedVars, ...elseInitializedVars]);
    const xorInitializedVars = new Set([
      ...[...thenInitializedVars].filter(x => !elseInitializedVars.has(x)),
      ...[...elseInitializedVars].filter(x => !thenInitializedVars.has(x)),
    ]);
    bothInitializedVars.forEach((identifier) => {
      const parentVarStatus = this.scope.lookupVariable(identifier);
      if (parentVarStatus !== null) {
        this.scope.assignVariable(identifier);
      }
    });
    xorInitializedVars.forEach((identifier) => {
      const parentVarStatus = this.scope.lookupVariable(identifier);
      if (parentVarStatus !== null && parentVarStatus.isReadOnly) {
        this.generateResolverError(node, `Late const assignment of variable "${identifier}" must occur in all branches`);
      }
    });
  }
  visitWhileStatement(node: WhileStatementSyntaxNode) {
    this.resolveSyntaxNode(node.cond);
    this.resolveSyntaxNode(node.loopBody);
    const loopInitializedVars = this.scopesByNode.get(node.loopBody)!.initializedVars;
    loopInitializedVars.forEach((identifier) => {
      const parentVarStatus = this.scope.lookupVariable(identifier);
      if (parentVarStatus !== null && parentVarStatus.isReadOnly) {
        this.generateResolverError(node, `Late const assignment of variable "${identifier}" may not occur in a loop`);
      }
    });
  }
  visitLogicShortCircuit(node: LogicShortCircuitSyntaxNode) {
    this.resolveSyntaxNode(node.left);
    this.resolveSyntaxNode(node.right);
  }
  visitClassDeclaration(node: ClassDeclarationSyntaxNode) {
    let baseClassType: ClassType | null = null;
    if (node.baseClassName !== null) {
      const lookedupBaseClassType = this.scope.lookupType(node.baseClassName.lexeme);
      if (lookedupBaseClassType instanceof ClassType === false) {
        this.generateResolverError(node, `Class declaration error: base class not declared or is not a class`);
        return;
      }
      baseClassType = lookedupBaseClassType as ClassType;
    }
    const interfaceTypes: Array<InterfaceType> = [];
    node.implementedInterfaceNames.forEach(interfaceNameToken => {
      const interfaceType = this.scope.lookupType(interfaceNameToken.lexeme);
      if (interfaceType instanceof InterfaceType === false) {
        this.generateResolverError(node, `Class declaration error: interface "${interfaceNameToken.lexeme}" not declared or is not an interface`);
        return;
      }
      interfaceTypes.push(interfaceType as InterfaceType);
    });
    const classType = new ClassType(node.referenceToken, node.newClassName.lexeme);
    classType.genericDefinition = node.genericDefinition;
    classType.baseClassType = baseClassType;
    classType.interfaceTypes = interfaceTypes;
    classType.fields = mapMap(node.fields, (typeAnnotation) => this.scope.resolveTypeAnnotation(typeAnnotation));
    // classType.methods = node.methods; // TODO: methods!
    this.scope.declareType(classType.name, classType);
  }
  visitTypeDeclaration(node: TypeDeclarationSyntaxNode) {
    // TODO: write a type system
    this.scope.declareType(node.identifier.lexeme, this.scope.resolveTypeAnnotation(node.typeAnnotation));
  }
  visitVariableLookup(node: VariableLookupSyntaxNode) {
    const identifier = node.identifier.lexeme;
    const existingVariableStatusInStack = this.scope.lookupVariable(identifier);
    if (existingVariableStatusInStack === null) {
      this.generateResolverError(node, `Undeclared variable "${identifier}" cannot be substituted`);
    }
    else {
      if (!this.scope.isVariableInitialized(identifier)) {
        this.generateResolverError(node, `Uninitialized variable "${identifier}" cannot be substituted`)
      }
    }
  }
  visitVariableAssignment(node: VariableAssignmentSyntaxNode) {
    if (node.rvalue !== null) {
      this.resolveSyntaxNode(node.rvalue);
    }
    const declarationModifier = node.modifier;
    const identifier = node.identifier.lexeme;
    let existingVariableStatusInStack = this.scope.lookupVariable(identifier);
    if (declarationModifier !== null) {
      if (existingVariableStatusInStack !== null) {
        this.generateResolverError(node, `Variable/parameter shadowing is not allowed`);
        return;
      }
      existingVariableStatusInStack = this.scope.declareVariable(identifier, node.typeAnnotation, declarationModifier.type === TokenType.KEYWORD_CONST);
    }
    else {
      if (existingVariableStatusInStack === null) {
        this.generateResolverError(node, `Undeclared variable cannot be assigned to`);
        return;
      }
    }
    if (node.rvalue !== null) {
      if (this.scope.isVariableInitialized(identifier) && existingVariableStatusInStack.isReadOnly) {
        this.generateResolverError(node, `Constant variable cannot be re-assigned to`);
        return;
      }
      this.scope.assignVariable(identifier);
    }
  }
  visitFunctionDefinition(node: FunctionDefinitionSyntaxNode) {
    for (const parameter of node.parameterList) {
      const parameterName = parameter.identifier.lexeme;
      if (this.scope.lookupVariable(parameterName) !== null) {
        this.generateResolverError(node, `Variable/parameter shadowing is not allowed`);
      }
    }
    this.beginScope(true, node, node.parameterList);
    this.resolveList(node.statementList);
    this.endScope();
  }
  visitFunctionCall(node: FunctionCallSyntaxNode) {
    this.resolveSyntaxNode(node.callee);
    for (const argument of node.argumentList) {
      this.resolveSyntaxNode(argument);
    }
  }
  visitReturnStatement(node: ReturnStatementSyntaxNode) {
    if (node.retvalExpr) {
      this.resolveSyntaxNode(node.retvalExpr);
    }
  }
}
