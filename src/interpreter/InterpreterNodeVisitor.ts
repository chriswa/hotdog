import chalk from "chalk"
import { IResolverOutput } from "../compiler/resolver/resolver"
import { SyntaxNodeVisitor, SyntaxNode, BinarySyntaxNode, UnarySyntaxNode, LiteralSyntaxNode, GroupingSyntaxNode, StatementBlockSyntaxNode, IfStatementSyntaxNode, WhileStatementSyntaxNode, ReturnStatementSyntaxNode, LogicShortCircuitSyntaxNode, VariableLookupSyntaxNode, ClassDeclarationSyntaxNode, TypeDeclarationSyntaxNode, ObjectInstantiationSyntaxNode, VariableAssignmentSyntaxNode, FunctionDefinitionSyntaxNode, FunctionCallSyntaxNode, MemberLookupSyntaxNode, MemberAssignmentSyntaxNode } from "../compiler/syntax/syntax"
import { ValueType } from "../compiler/syntax/ValueType"
import { TokenType } from "../compiler/Token"
import { ClassType } from "../types"
import { throwExpr } from "../util"
import { Interpreter } from "./Interpreter"
import { InterpreterScope } from "./InterpreterScope"
import { InterpreterValue, InterpreterValueBoolean, InterpreterValueBuiltin, InterpreterValueClosure, interpreterValueFactory, InterpreterValueFloat32, InterpreterValueObject, InterpreterValueVoid } from "./InterpreterValue"
import { NodeVisitationState } from "./NodeVisitationState"

export class InterpreterNodeVisitor implements SyntaxNodeVisitor<void> {
  private nodeVisitationState: NodeVisitationState | undefined;
  private nodeInsertionBuffer: Array<NodeVisitationState> = [];
  constructor(
    private interpreter: Interpreter,
  ) { }
  setCurrentNodeVisitationState(nodeVisitationState: NodeVisitationState) {
    this.nodeVisitationState = nodeVisitationState;
  }
  pushNewNode(node: SyntaxNode | null) {
    if (node === null) { return } // e.g. IfStatementSyntaxNode.elseBranch
    this.nodeInsertionBuffer.push(new NodeVisitationState(node));
  }
  repushIncremented() {
    this.nodeVisitationState!.state += 1;
    this.nodeInsertionBuffer.push(this.nodeVisitationState!);
  }
  repush() {
    this.nodeVisitationState!.state = 0;
    this.nodeInsertionBuffer.push(this.nodeVisitationState!);
  }
  getState() {
    return this.nodeVisitationState!.state;
  }
  switchState(stateFunctions: Array<() => void>) {
    const state = this.getState();
    if (state > stateFunctions.length - 1) {
      throw new Error(`switchState state logic fail!`);
    }
    stateFunctions[state]();
  }
  pushValue(interpreterValue: InterpreterValue) {
    if (this.interpreter.isDebug) {
      console.log(chalk.blue(`pushValue: ${interpreterValue.toString()}`))
    }
    this.interpreter.valueStack.push(interpreterValue);
  }
  popValue() {
    const interpreterValue = this.interpreter.valueStack.pop();
    if (interpreterValue === undefined) { throw new Error(`popValue logic fail!`) }
    if (this.interpreter.isDebug) {
      console.log(chalk.blue(`popValue: ${interpreterValue.toString()}`))
    }
    return interpreterValue;
  }

  visit(node: SyntaxNode) {
    node.accept(this);
    this.interpreter.nodeStack.unshift(...this.nodeInsertionBuffer);
    this.nodeInsertionBuffer = [];
  }
  // ╔════════════════════════════════════════╗
  // ║ Binary expression                      ║
  // ╚════════════════════════════════════════╝
  visitBinary(node: BinarySyntaxNode): void {
    this.switchState([
      () => {
        this.pushNewNode(node.left);
        this.pushNewNode(node.right);
        this.repushIncremented();
      },
      () => {
        const left = this.popValue();
        const right = this.popValue();
        switch (node.op.type) {
          case TokenType.PLUS: /* OpCode.ADD */ this.pushValue(new InterpreterValueFloat32(left.asFloat32().value + right.asFloat32().value)); break;
          case TokenType.MINUS: /* OpCode.SUBTRACT */ this.pushValue(new InterpreterValueFloat32(left.asFloat32().value - right.asFloat32().value)); break;
          case TokenType.ASTERISK: /* OpCode.MULTIPLY */ this.pushValue(new InterpreterValueFloat32(left.asFloat32().value * right.asFloat32().value)); break;
          case TokenType.FORWARD_SLASH: /* OpCode.DIVIDE */ this.pushValue(new InterpreterValueFloat32(left.asFloat32().value / right.asFloat32().value)); break;
          case TokenType.LESS_THAN: /* OpCode.LT */ this.pushValue(new InterpreterValueBoolean(left.asFloat32().value < right.asFloat32().value)); break;
          case TokenType.LESS_THAN_OR_EQUAL: /* OpCode.LTE */ this.pushValue(new InterpreterValueBoolean(left.asFloat32().value <= right.asFloat32().value)); break;
          case TokenType.GREATER_THAN: /* OpCode.GT */ this.pushValue(new InterpreterValueBoolean(left.asFloat32().value > right.asFloat32().value)); break;
          case TokenType.GREATER_THAN_OR_EQUAL: /* OpCode.GTE */ this.pushValue(new InterpreterValueBoolean(left.asFloat32().value >= right.asFloat32().value)); break;
          case TokenType.DOUBLE_EQUAL: /* OpCode.EQ */ this.pushValue(new InterpreterValueBoolean(left.compareStrictEquality(right) === true)); break;
          case TokenType.BANG_EQUAL: /* OpCode.NEQ */ this.pushValue(new InterpreterValueBoolean(left.compareStrictEquality(right) === false)); break;
          default: throw new Error(`unknown binary op`);
        }
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ Unary expression                       ║
  // ╚════════════════════════════════════════╝
  visitUnary(node: UnarySyntaxNode): void {
    this.switchState([
      () => {
        this.pushNewNode(node.right);
        this.repushIncremented();
      },
      () => {
        const right = this.popValue();
        switch (node.op.type) {
          case TokenType.MINUS: /* OpCode.SUBTRACT */ this.pushValue(new InterpreterValueFloat32(-right.asFloat32().value)); break;
          case TokenType.BANG: /* OpCode.MULTIPLY */ this.pushValue(new InterpreterValueBoolean(!right.asBoolean().value)); break;
          default: throw new Error(`unknown unary op`);
        }
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ Literal expression                     ║
  // ╚════════════════════════════════════════╝
  visitLiteral(node: LiteralSyntaxNode): void {
    switch (node.type) {
      case ValueType.NUMBER: this.pushValue(new InterpreterValueFloat32(node.value as number)); break;
      case ValueType.BOOLEAN: this.pushValue(new InterpreterValueBoolean(node.value as boolean)); break;
      default: throw new Error(`unsupported literal type`);
    }
  }
  // ╔════════════════════════════════════════╗
  // ║ Grouping expression                    ║
  // ╚════════════════════════════════════════╝
  visitGrouping(node: GroupingSyntaxNode): void {
    this.pushNewNode(node.expr);
  }
  // ╔════════════════════════════════════════╗
  // ║ Statement Block                        ║
  // ╚════════════════════════════════════════╝
  visitStatementBlock(node: StatementBlockSyntaxNode): void {
    node.statementList.forEach((statementNode) => {
      this.pushNewNode(statementNode);
    });
  }
  // ╔════════════════════════════════════════╗
  // ║ If Statement                           ║
  // ╚════════════════════════════════════════╝
  visitIfStatement(node: IfStatementSyntaxNode): void {
    this.switchState([
      () => {
        this.pushNewNode(node.cond);
        this.repushIncremented();
      },
      () => {
        const cond = this.popValue().asBoolean().value;
        this.pushNewNode(cond ? node.thenBranch : node.elseBranch);
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ While Statement                        ║
  // ╚════════════════════════════════════════╝
  visitWhileStatement(node: WhileStatementSyntaxNode): void {
    this.switchState([
      () => {
        this.pushNewNode(node.cond);
        this.repushIncremented();
      },
      () => {
        const cond = this.popValue().asBoolean().value;
        if (cond) {
          this.pushNewNode(node.loopBody);
          this.repush();
        }
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ Return Statement                       ║
  // ╚════════════════════════════════════════╝
  visitReturnStatement(node: ReturnStatementSyntaxNode): void {
    this.pushNewNode(node.retvalExpr);
    // remove remaining nodes in function to skip out of it
    while (true) {
      const foo = this.interpreter.nodeStack.shift()!;
      if (foo.node instanceof FunctionCallSyntaxNode) {
        break;
      }
    }
  }
  // ╔════════════════════════════════════════╗
  // ║ Logic Short Circuit expression         ║
  // ╚════════════════════════════════════════╝
  visitLogicShortCircuit(node: LogicShortCircuitSyntaxNode): void {
    const isOpOr = node.op.type === TokenType.DOUBLE_PIPE;
    this.switchState([
      () => {
        this.pushNewNode(node.left);
        this.repushIncremented();
      },
      () => {
        const left = this.popValue().asBoolean().value;
        if ((isOpOr && left === false) || (!isOpOr && left === true)) {
          this.pushNewNode(node.left);
        }
        else {
          this.pushValue(new InterpreterValueBoolean(false));
        }
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ Variable Lookup                        ║
  // ╚════════════════════════════════════════╝
  visitVariableLookup(node: VariableLookupSyntaxNode): void {
    this.pushValue(this.interpreter.scope.getValue(node.identifier.lexeme));
  }
  // ╔════════════════════════════════════════╗
  // ║ Variable Assignment                    ║
  // ╚════════════════════════════════════════╝
  visitVariableAssignment(node: VariableAssignmentSyntaxNode): void {
    this.switchState([
      () => {
        this.pushNewNode(node.rvalue);
        this.repushIncremented();
      },
      () => {
        const rvalue = this.popValue();
        // const varDef = this.interpreter.scope.getVariableDefinition(node.identifier.lexeme); // maybe needed for type coercion?
        this.interpreter.scope.setValue(node.identifier.lexeme, rvalue);
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ Object Instantiation                   ║
  // ╚════════════════════════════════════════╝
  visitObjectInstantiation(node: ObjectInstantiationSyntaxNode): void {
    this.switchState([
      () => {
        node.constructorArgumentList.forEach((argumentNode) => {
          this.pushNewNode(argumentNode);
        })
        this.repushIncremented();
      },
      () => {
        const classType = getClassTypeOrDie(this.interpreter.scope, node.className.lexeme);
        const newObject = new InterpreterValueObject(classType as ClassType);
        this.pushValue(newObject);

        const classNode = getClassNodeForClassType(this.interpreter.resolverOutput, classType);
        // const classScope = this.interpreter.resolverOutput.scopesByNode.get(classNode) ?? throwExpr(new Error(`couldn't look up class scope for class node`));

        // call constructor
        const argumentList = node.constructorArgumentList.map((_argumentNode) => this.popValue()).reverse();

        const ctor = classNode.methods.get('new') ?? throwExpr(new Error(`TODO: support implicit constructors`));
        
        this.interpreter.pushScope(ctor);
        this.interpreter.scope.overrideValueInThisScope('this', newObject);
        const methodScope = this.interpreter.resolverOutput.scopesByNode.get(ctor) ?? throwExpr(new Error(`couldn't look up resolver scope for ctor`));
        // methodScope.getClosedVars().forEach((identifier) => {
        //   this.interpreter.scope.getValue(identifier);
        // });
        ctor.parameterList.forEach((functionParameter) => {
          this.interpreter.scope.overrideValueInThisScope(functionParameter.identifier.lexeme, argumentList.shift()!)
        })
        ctor.statementList.forEach((statementNode) => {
          this.pushNewNode(statementNode)
        })
        this.repushIncremented();

      },
      () => {
        this.interpreter.popScope();
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ Function Call                          ║
  // ╚════════════════════════════════════════╝
  visitFunctionCall(node: FunctionCallSyntaxNode): void {
    this.switchState([
      () => {
        node.argumentList.forEach((argumentNode) => {
          this.pushNewNode(argumentNode);
        });
        this.pushNewNode(node.callee);
        this.repushIncremented();
      },
      () => {
        const callee = this.popValue();
        const argumentList = node.argumentList.map((_argumentNode) => this.popValue()).reverse()
        if (callee instanceof InterpreterValueClosure) {
          this.interpreter.pushScope(callee.node)
          callee.closedVars.forEach((value, identifier) => {
            this.interpreter.scope.overrideValueInThisScope(identifier, value)
          })
          const functionDefinition = callee.node as FunctionDefinitionSyntaxNode
          functionDefinition.parameterList.forEach((functionParameter) => {
            this.interpreter.scope.overrideValueInThisScope(functionParameter.identifier.lexeme, argumentList.shift()!)
          })
          functionDefinition.statementList.forEach((statementNode) => {
            this.pushNewNode(statementNode)
          })
          this.repushIncremented();
        }
        else if (callee instanceof InterpreterValueBuiltin) {
          const args = argumentList.map((interpreterValue, index) => interpreterValue.toJavascriptValue());
          const retval = callee.builtin.handler(args);
          const retvalInterpreterValue = interpreterValueFactory(callee.builtin.type.returnType, retval);
          if (retvalInterpreterValue instanceof InterpreterValueVoid === false) {
            this.pushValue(retvalInterpreterValue);
          }
        }
        else {
          throw new Error(`runtime: can't call ${callee.toString()} as a function!`);
        }
      },
      () => {
        this.interpreter.popScope();
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ Function Definition                    ║
  // ╚════════════════════════════════════════╝
  visitFunctionDefinition(node: FunctionDefinitionSyntaxNode): void {
    const closedVars: Map<string, InterpreterValue> = new Map();
    this.interpreter.resolverOutput.scopesByNode.get(node)!.getClosedVars().forEach((identifier) => {
      closedVars.set(identifier, this.interpreter.scope.getValue(identifier));
    });
    const value = new InterpreterValueClosure(node, closedVars);
    this.pushValue(value);
  }
  // ╔════════════════════════════════════════╗
  // ║ Member Lookup                          ║
  // ╚════════════════════════════════════════╝
  visitMemberLookup(node: MemberLookupSyntaxNode): void {
    this.switchState([
      () => {
        this.pushNewNode(node.object);
        this.repushIncremented();
      },
      () => {
        const object = this.popValue().asObject();
        const classNode = getClassNodeForClassType(this.interpreter.resolverOutput, object.classType);
        const propertyName = node.memberName.lexeme;
        const method = classNode.methods.get(propertyName);
        if (method === undefined) {
          this.pushValue(object.getField(propertyName));
        }
        else {
          const closedVars: Map<string, InterpreterValue> = new Map();
          closedVars.set('this', object);
          const value = new InterpreterValueClosure(method, closedVars);
          this.pushValue(value);
        }
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ Member Assignment                      ║
  // ╚════════════════════════════════════════╝
  visitMemberAssignment(node: MemberAssignmentSyntaxNode): void {
    this.switchState([
      () => {
        this.pushNewNode(node.rvalue);
        this.pushNewNode(node.object);
        this.repushIncremented();
      },
      () => {
        const object = this.popValue().asObject();
        const rvalue = this.popValue();
        object.setField(node.memberName.lexeme, rvalue);
        // this.pushValue(rvalue);
      },
    ]);
  }
  // ╔════════════════════════════════════════╗
  // ║ Class Declaration                      ║
  // ╚════════════════════════════════════════╝
  visitClassDeclaration(node: ClassDeclarationSyntaxNode): void {
    // noop
  }
  // ╔════════════════════════════════════════╗
  // ║ Type Declaration                       ║
  // ╚════════════════════════════════════════╝
  visitTypeDeclaration(node: TypeDeclarationSyntaxNode): void {
    // noop
  }
}

function getClassTypeOrDie(interpreterScope: InterpreterScope, className: string): ClassType {
  const classType = interpreterScope.getType(className);
  if (classType instanceof ClassType) {
    return classType;
  }
  else if (classType === null) {
    throw new Error(`could not instantiate "new" object, class "${className}" not found`)
  }
  else {
    throw new Error(`could not instantiate "new" object, class "${className}" is not a class`)
  }
}

function getClassNodeForClassType(resolverOutput: IResolverOutput, classType: ClassType): ClassDeclarationSyntaxNode {
  return resolverOutput.classNodesByClassType.get(classType) ?? throwExpr(new Error(`couldn't look up class node for classType`));
}