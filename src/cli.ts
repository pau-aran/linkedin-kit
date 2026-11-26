#!/usr/bin/env bun

const usage = `lk - LinkedIn from the terminal

Usage:
  lk login             sign in and save the browser session
  lk status            show whether the saved session works
  lk api               print the li client TypeScript API
  lk run <file|->      run a script with \`li\` in scope; --write allows profile writes
`;

const [command] = process.argv.slice(2);

switch (command) {
  case undefined:
  case "help":
  case "--help":
    console.log(usage);
    break;
  default:
    console.error(`lk: unknown command "${command}"\n\n${usage}`);
    process.exit(2);
}
