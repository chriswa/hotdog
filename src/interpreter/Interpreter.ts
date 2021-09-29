import chalk from "chalk"
import { builtinsByName } from "../builtins/builtins"
import { IResolverOutput, resolve } from "../compiler/resolver/resolver"
import { ResolverScope } from "../compiler/resolver/ResolverScope"
import { SyntaxNode } from "../compiler/syntax/syntax"
import { sourceReporter } from "../sourceReporter"
import { drawBox } from "../testing/reporting"
import { InternalError, mapMapToArray } from "../util"
import { InterpreterNodeVisitor } from "./InterpreterNodeVisitor"
import { InterpreterScope } from "./InterpreterScope"
import { InterpreterValue, InterpreterValueBuiltin } from "./InterpreterValue"
import { NodeVisitationState } from "./NodeVisitationState"

export interface IInterpreterFacade {
  isHalted(): boolean;
  runOneStep(): void;
}

export class Interpreter implements IInterpreterFacade {
  _isHalted: boolean = false;
  isHalted(): boolean {
    return this._isHalted;
  }

  private nodeVisitor: InterpreterNodeVisitor;

  ast: SyntaxNode;
  resolverOutput: IResolverOutput;
  nodeVisitationStateStack: Array<NodeVisitationState> = [];
  valueStack: Array<InterpreterValue> = [];
  scope: InterpreterScope;
  
  constructor(
    private path: string,
    source: string,
    public isDebug: boolean,
  ) {
    const { ast, resolverOutput } = resolve(source, path, isDebug);
    if (isDebug) {
      console.log(chalk.yellow(drawBox(`ResolverOutput`)));
      resolverOutput.scopesByNode.forEach((scope, node) => {
        sourceReporter.printPositionInSource(this.path, node.referenceToken.charPos);
        const closedVars = (scope as ResolverScope).getClosedVars();
        if (closedVars.length > 0) {
          console.log(chalk.yellow('closedVars: ') + chalk.white(closedVars.join(', ')));
        }
        console.log(chalk.yellow('vars: ') + chalk.white(mapMapToArray((scope as ResolverScope).variableDefinitions, (varDef, identifier) => {
          return `${identifier}: ${varDef.typeWrapper.toString()}`;
        }).join(', ')));
        console.log(chalk.yellow('types: ') + chalk.white(mapMapToArray((scope as ResolverScope).typeWrappers, (type, identifier) => {
          return `${identifier}: ${type.toString()}`;
        }).join(', ')));
      });
      console.log(chalk.magenta(drawBox(`Interpretation Begins...`)));
    }
    this.ast = ast;
    this.resolverOutput = resolverOutput;
    this.nodeVisitor = new InterpreterNodeVisitor(this);
    this.nodeVisitationStateStack = [new NodeVisitationState(ast)];
    this.scope = new InterpreterScope(null, ast, resolverOutput);
    builtinsByName.forEach((builtin, builtinName) => {
      this.scope.overrideValueInThisScope(builtinName, new InterpreterValueBuiltin(builtin));
    });
  }

  pushScope(node: SyntaxNode) {
    this.scope = new InterpreterScope(this.scope, node, this.resolverOutput);
  }
  popScope() {
    if (this.scope.parentScope === null) {
      throw new InternalError(`attempted to pop top scope!`);
    }
    this.scope = this.scope.parentScope;
  }

  runOneStep() {
    const nextNodeVisitationState = this.nodeVisitationStateStack.shift()!;
    
    if (this.isDebug) {
      console.log(chalk.bgWhite.black(`runOneStep: ${nextNodeVisitationState.node.constructor.name} - step ${nextNodeVisitationState.stepCounter}`));
      sourceReporter.printPositionInSource(this.path, nextNodeVisitationState.node.referenceToken.charPos);
    }

    this.nodeVisitor.setCurrentNodeVisitationState(nextNodeVisitationState);

    this.nodeVisitor.visit(nextNodeVisitationState.node);

    if (this.nodeVisitationStateStack.length === 0) {
      this._isHalted = true;
    }
  }
}
