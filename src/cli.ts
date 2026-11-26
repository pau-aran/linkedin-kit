#!/usr/bin/env bun

import { Console } from "node:console";
import { parseArgs } from "node:util";
import { createLi } from "./client.ts";
import { runLiScript } from "./run.ts";
import { login } from "./session.ts";

const usage = `lk - LinkedIn from the terminal

Usage:
  lk login             sign in and save the browser session
  lk status            show whether the saved session works
  lk api               print the li client TypeScript API
  lk run <file|->      run a script with \`li\` in scope; --write allows profile writes
`;

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case undefined:
    case "help":
    case "--help":
      console.log(usage);
      break;
    case "login":
      await login();
      break;
    case "api":
      process.stdout.write(await Bun.file(new URL("./li.ts", import.meta.url)).text());
      break;
    case "run": {
      const { values, positionals } = parseArgs({
        args,
        options: { write: { type: "boolean", default: false } },
        allowPositionals: true,
      });
      const [file] = positionals;
      if (!file || positionals.length !== 1) {
        console.error("Usage: lk run <file|-> [--write]");
        process.exitCode = 2;
        break;
      }
      Object.assign(console, new Console(process.stderr));
      const source = await (file === "-" ? Bun.stdin : Bun.file(file)).text();
      const result = await runLiScript(source, { allowWrite: values.write }, createLi);
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        break;
      }
      process.stdout.write(`${JSON.stringify(result.value) ?? "null"}\n`);
      break;
    }
    default:
      console.error(`lk: unknown command "${command}"\n\n${usage}`);
      process.exit(2);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
