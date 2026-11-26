import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, createQueue } from "../src/session.ts";

const lockPath = () => join(mkdtempSync(join(tmpdir(), "lk-")), "session.lock");

test("a second session is refused while the first holds the lock", () => {
  const file = lockPath();
  const release = acquireLock(file);
  expect(() => acquireLock(file)).toThrow(/another session is running/);
  release();
  expect(existsSync(file)).toBe(false);
});

test("a lock left by a dead process is taken over", () => {
  const file = lockPath();
  writeFileSync(file, "999999999");
  const release = acquireLock(file);
  release();
});

test("the queue runs tasks one at a time, spaced by the interval", async () => {
  const queue = createQueue(50);
  const log: string[] = [];
  const starts: number[] = [];
  const task = (name: string) => async () => {
    starts.push(Date.now());
    log.push(`start ${name}`);
    await Bun.sleep(10);
    log.push(`end ${name}`);
  };
  await Promise.all([queue(task("a")), queue(task("b"))]);
  expect(log).toEqual(["start a", "end a", "start b", "end b"]);
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(45);
});

test("a failed task does not stop the queue", async () => {
  const queue = createQueue(0);
  const failed = queue(async () => {
    throw new Error("boom");
  });
  await expect(failed).rejects.toThrow("boom");
  expect(await queue(async () => "ok")).toBe("ok");
});
