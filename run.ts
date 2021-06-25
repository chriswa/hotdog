import chalk from "chalk"
import fs from "fs";
import { printPositionInSource } from "./cliUtil"
import { Interpreter } from "./interpreter/interpreter"
import { parse } from "./parser/parser"

var myArgs = process.argv.slice(2);

const path = myArgs.shift();
if (path === undefined) {
  console.log("must specify script filename as first argv");
  process.exit(1);
}

const source = fs.readFileSync(path, "utf8");
const parserResponse = parse(source, path);
if (parserResponse.parserErrors !== null) {
  const firstParserError = parserResponse.parserErrors[0];
  console.log(chalk.red(`PARSER ERROR: ${firstParserError.message}`));
  printPositionInSource(firstParserError.path, source, firstParserError.charPos);
  process.exit(1);
}

const interpreter = new Interpreter();
const runtimeError = interpreter.interpret(parserResponse.topSyntaxNode!);
if (runtimeError !== null) {
  console.log(chalk.red(`RUNTIME ERROR: ${runtimeError.message}`));
  printPositionInSource(runtimeError.token.path, source, runtimeError.token.charPos);
  process.exit(1);
}

console.log(interpreter.getOutput());

