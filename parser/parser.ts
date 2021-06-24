import { lex } from "./lexer";
import { Token, TokenType } from "./Token";
import { BinarySyntaxNode, LiteralSyntaxNode, UnarySyntaxNode, SyntaxNode, StatementBlockSyntaxNode, IfStatementSyntaxNode, WhileStatementSyntaxNode, LogicShortCircuitSyntaxNode, VariableIdentifierSyntaxNode, VariableAssignmentSyntaxNode, FunctionDefinitionSyntaxNode, FunctionCallSyntaxNode, ReturnStatementSyntaxNode } from "../syntax/syntax";
import { ValueType } from "../interpreter/Value"

class ParseError {
  constructor(
    public token: Token,
    public message: string,
  ) { }
}

class TokenReader {
  private index = 0;
  public constructor(
    private tokens: Array<Token>,
    private parseErrorGenerator: (token: Token, message: string) => ParseError,
  ) {
  }
  public peek() {
    return this.tokens[this.index];
  }
  public isAtEnd() {
    return this.peek().type === TokenType.EOF;
  }
  public previous() {
    return this.tokens[this.index - 1];
  }
  public check(requiredTypes: Array<TokenType>) {
    const peekedType = this.peek().type;
    return requiredTypes.indexOf(peekedType) > -1;
  }
  public match(requiredTypes: Array<TokenType>) {
    const isMatch = this.check(requiredTypes);
    if (isMatch) {
      this.advance();
    }
    return isMatch;
  }
  public advance() {
    if (this.isAtEnd()) {
      throw this.parseErrorGenerator(this.peek(), `Unexpected end-of-file!`);
    }
    this.index += 1;
  }
  public consume(requiredType: TokenType, errorMessage: string) {
    if (this.check([requiredType])) {
      this.advance();
      return this.previous();
    }
    else {
      throw this.parseErrorGenerator(this.peek(), `Parse error: ${errorMessage}`);
    }
  }
}

class ParserResponse {
  public constructor(
    public syntaxNodes: SyntaxNode | null,
    public parseErrors: Array<ParseError> | null,
  ) { }
}

export function parse(input: string, path: string): ParserResponse {
  const tokens = lex(input, path);
  const reader = new TokenReader(tokens, generateParseError);
  const parseErrors: Array<ParseError> = [];
  try {
    return new ParserResponse(module(), null);
  }
  catch (error) {
    return new ParserResponse(null, parseErrors);
  }

  function generateParseError(token: Token, message: string) {
    const parseError = new ParseError(token, message);
    parseErrors.push(parseError);
    return parseError;
  }

  function synchronizeAfterParseError() {
    reader.advance();
    while (!reader.isAtEnd()) {
      if (reader.previous().type === TokenType.SEMICOLON) {
        return;
      }
      if (reader.check([
        TokenType.KEYWORD_IF, // TODO: etc
      ])) {
        return;
      }
      reader.advance();
    }
  }

  function metaBinary(subGrammar: () => SyntaxNode, operators: Array<TokenType>) {
    let expr: SyntaxNode = subGrammar();
    while (reader.match(operators)) {
      const op = reader.previous();
      const right = subGrammar();
      expr = new BinarySyntaxNode(op, expr, op, right);
    }
    return expr;
  }

  function module() {
    const referenceToken = reader.peek();
    const statementList: Array<SyntaxNode> = [];
    while (!reader.isAtEnd()) {
      statementList.push(statement())
    }
    return new StatementBlockSyntaxNode(referenceToken, statementList);
  }
  function statement() {
    if (reader.match([TokenType.OPEN_BRACE])) {
      return block();
    }
    else if (reader.match([TokenType.KEYWORD_CONST, TokenType.KEYWORD_LET])) {
      return variableDeclarationStatement();
    }
    else if (reader.match([TokenType.KEYWORD_IF])) {
      return ifStatement();
    }
    else if (reader.match([TokenType.KEYWORD_WHILE])) {
      return whileStatement();
    }
    else if (reader.match([TokenType.KEYWORD_RETURN])) {
      return returnStatement();
    }
    const expr = expression();
    reader.consume(TokenType.SEMICOLON, `Semicolon expected after expression statement`);
    return expr;
  }
  function variableDeclarationStatement() {
    const modifier = reader.previous();
    const identifier = reader.consume(TokenType.IDENTIFIER, `lvalue in variable declaration statement must be an identifier`);
    let rvalue: SyntaxNode | null = null;
    if (reader.match([TokenType.OP_ASSIGN])) {
      rvalue = expression();
    }
    reader.consume(TokenType.SEMICOLON, `Semicolon expected after variable assignment statement`);
    return new VariableAssignmentSyntaxNode(modifier, modifier, identifier, rvalue);
  }
  function ifStatement() {
    const referenceToken = reader.previous();
    reader.consume(TokenType.OPEN_PAREN, `Open paren expected after "if" statement`);
    const condExpr = expression();
    reader.consume(TokenType.CLOSE_PAREN, `Open paren expected after "if" statement`);
    reader.consume(TokenType.OPEN_BRACE, `Opening curly brace required for "if" statement's "then" block`);
    const thenBlock = block();
    reader.consume(TokenType.CLOSE_BRACE, `Closing curly brace required after "if" statement's "then" block`);
    let elseBlock = null;
    if (reader.match([TokenType.KEYWORD_ELSE])) {
      reader.consume(TokenType.OPEN_BRACE, `Opening curly brace required for "if" statement's "else" block`);
      elseBlock = block();
      reader.consume(TokenType.CLOSE_BRACE, `Closing curly brace required after "if" statement's "else" block`);
    }
    return new IfStatementSyntaxNode(referenceToken, condExpr, thenBlock, elseBlock);
  }
  function whileStatement() {
    const referenceToken = reader.previous();
    reader.consume(TokenType.OPEN_PAREN, `Open paren expected after "while" statement`);
    const condExpr = expression();
    reader.consume(TokenType.CLOSE_PAREN, `Open paren expected after "while" statement`);
    reader.consume(TokenType.OPEN_BRACE, `Opening curly brace required for "while" statement's "then" block`);
    const thenBlock = block();
    reader.consume(TokenType.CLOSE_BRACE, `Closing curly brace required after "while" statement's "then" block`);
    return new WhileStatementSyntaxNode(referenceToken, condExpr, thenBlock);
  }
  function returnStatement() {
    const referenceToken = reader.previous();
    let retval: SyntaxNode | null = null;
    if (!reader.check([TokenType.SEMICOLON])) {
      retval = expression();
    }
    reader.consume(TokenType.SEMICOLON, `Return statement must end with semicolon`);
    return new ReturnStatementSyntaxNode(referenceToken, retval);
  }
  function block(errorMessageForMissingCloseBrace: string | null = null) {
    const referenceToken = reader.previous();
    const statementList: Array<SyntaxNode> = [];
    while (!reader.check([TokenType.CLOSE_BRACE]) && !reader.isAtEnd()) {
      statementList.push(statement());
    }
    reader.consume(TokenType.CLOSE_BRACE, errorMessageForMissingCloseBrace ?? `Closing curly brace required after statement block`);
    return new StatementBlockSyntaxNode(referenceToken, statementList);
  }
  function expression(): SyntaxNode {
    return assignment()
  }
  function assignment() {
    const expr = anonymousFunction();
    if (reader.match([TokenType.OP_ASSIGN])) {
      const referenceToken = reader.previous();
      const rvalue = expression();
      if (expr instanceof VariableIdentifierSyntaxNode) {
        reader.consume(TokenType.SEMICOLON, `semicolon required after variable assignment`);
        return new VariableAssignmentSyntaxNode(referenceToken, null, expr.identifier, rvalue);
      }
      else {
        throw new Error("TODO: support object assignment");
      }
    }
    return expr;
  }
  function anonymousFunction() {
    if (reader.match([TokenType.KEYWORD_FN])) {
      const referenceToken = reader.previous();
      reader.consume(TokenType.OPEN_PAREN, `function definition must start with "(" for parameterList`);
      const parameterList: Array<Token> = [];
      let isFirst = true;
      while (true) {
        if (reader.match([TokenType.CLOSE_PAREN])) {
          break;
        }
        if (!isFirst) {
          reader.consume(TokenType.COMMA, `function arguments must be separated by commas`);
        }
        isFirst = false;
        if (!reader.match([TokenType.IDENTIFIER])) {
          throw generateParseError(reader.peek(), `identifier expected in function argument list`);
        }
        parameterList.push(reader.previous());
      }
      reader.consume(TokenType.OPEN_BRACE, `function body must start with "{"`);
      const blockNode = block(`function body must end with "}"`);
      return new FunctionDefinitionSyntaxNode(referenceToken, parameterList, blockNode);
    }
    return or();
  }
  function or() {
    let expr = and();
    while (reader.match([TokenType.OP_OR])) {
      const op = reader.previous();
      const right = and();
      expr = new LogicShortCircuitSyntaxNode(op, expr, op, right);
    }
    return expr;
  }
  function and() {
    let expr = equality();
    while (reader.match([TokenType.OP_AND])) {
      const op = reader.previous();
      const right = equality();
      expr = new LogicShortCircuitSyntaxNode(op, expr, op, right);
    }
    return expr;
  }
  function equality() {
    return metaBinary(comparison, [TokenType.OP_EQ, TokenType.OP_NEQ]);
  }
  function comparison() {
    return metaBinary(addSubExpr, [TokenType.OP_GT, TokenType.OP_GTE, TokenType.OP_LT, TokenType.OP_LTE]);
  }
  function addSubExpr() {
    return metaBinary(multDivExpr, [TokenType.OP_PLUS, TokenType.OP_MINUS]);
  }
  function multDivExpr() {
    return metaBinary(unary, [TokenType.OP_MULT, TokenType.OP_DIV]);
  }
  function unary(): SyntaxNode {
    if (reader.match([TokenType.OP_BANG, TokenType.OP_MINUS])) {
      const op = reader.previous();
      const right = unary();
      return new UnarySyntaxNode(op, op, right);
    }
    return call();
  }
  function call() {
    let expr = primary();
    while (true) {
      if (reader.match([TokenType.OPEN_PAREN])) {
        expr = finishCall(expr);
      }
      else {
        break
      }
    }
    return expr;
  }
  function finishCall(callee: SyntaxNode) {
    const referenceToken = reader.previous();
    const argumentList: Array<SyntaxNode> = [];
    if (!reader.check([TokenType.CLOSE_PAREN])) {
      do {
        argumentList.push(expression());
      } while (reader.match([TokenType.COMMA]));
    }
    const _closingParen = reader.consume(TokenType.CLOSE_PAREN, `Expect ')' after arguments.`);
    return new FunctionCallSyntaxNode(referenceToken, callee, argumentList);
  }
  function primary() {
    if (reader.match([TokenType.LITERAL_FALSE])) {
      return new LiteralSyntaxNode(reader.previous(), false, ValueType.BOOLEAN);
    }
    if (reader.match([TokenType.LITERAL_TRUE])) {
      return new LiteralSyntaxNode(reader.previous(), true, ValueType.BOOLEAN);
    }
    if (reader.match([TokenType.LITERAL_NULL])) {
      return new LiteralSyntaxNode(reader.previous(), null, ValueType.NULL); // ?
    }
    if (reader.match([TokenType.NUMBER])) {
      return new LiteralSyntaxNode(reader.previous(), parseFloat(reader.previous().lexeme), ValueType.NUMBER);
    }
    if (reader.match([TokenType.STRING])) {
      let string = reader.previous().lexeme;
      string = unescapeString(string.substr(1, string.length - 2)); // strip quotes and then unescape newlines, tabs, etc
      return new LiteralSyntaxNode(reader.previous(), string, ValueType.STRING);
    }
    if (reader.match([TokenType.IDENTIFIER])) {
      return new VariableIdentifierSyntaxNode(reader.previous(), reader.previous());
    }
    if (reader.match([TokenType.OPEN_PAREN])) {
      const expr = expression();
      reader.consume(TokenType.CLOSE_PAREN, "Expect ')' after expression.");
      return expr;
    }
    throw generateParseError(reader.peek(), `expecting expression`);
  }
}

const backslashSequences: Record<string, string> = {
  "n": "\n",
  "t": "\t",
  "\"": "\"", // redundant
}

function unescapeString(unescapedString: string): string {
  return unescapedString.replace(/\\./g, (substring) => {
    const char = substring.substr(1, 1);
    if (char in backslashSequences) {
      return backslashSequences[char];
    }
    return char; // TODO: error instead?
  });
}

