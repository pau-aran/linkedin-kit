import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));

test("lk api prints the Li contract from outside the project root", async () => {
  const result = Bun.spawnSync([process.execPath, cli, "api"], { cwd: import.meta.dir });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe(await Bun.file(new URL("./li.ts", import.meta.url)).text());
});

test("lk run - reads stdin and reports invalid TypeScript only on stderr", () => {
  const result = Bun.spawnSync([process.execPath, cli, "run", "-"], {
    stdin: Buffer.from("const broken: = ;"),
  });

  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toContain("Parse error");
});
