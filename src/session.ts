// One browser session at a time, and one sequential, rate-limited queue for every LinkedIn call.

import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext } from "patchright";
import { createVoyager, getMe } from "./voyager.ts";

export const STATE_DIR = join(homedir(), ".linkedin-kit");
const PROFILE_DIR = join(STATE_DIR, "browser");
const LOCK_FILE = join(STATE_DIR, "session.lock");

/** Minimum gap between two LinkedIn calls. */
const MIN_INTERVAL_MS = 1500;

/** Take the lock file, or throw if a live process holds it. Returns the release function. */
export function acquireLock(file: string): () => void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(readFileSync(file, "utf8"));
      if (isAlive(pid)) throw new Error(`lk: another session is running (pid ${pid}); wait for it to finish`);
      unlinkSync(file);
    }
  }
  throw new Error(`lk: could not take the session lock ${file}`);
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Runs tasks one after another, starting each at least `minIntervalMs` after the previous one started. */
export function createQueue(minIntervalMs: number): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  return (task) => {
    const run = tail.then(async () => {
      const wait = lastStart + minIntervalMs - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      lastStart = Date.now();
      return task();
    });
    tail = run.catch(() => {});
    return run;
  };
}

export interface Session {
  context: BrowserContext;
  /** Every LinkedIn call goes through here. */
  queue: <T>(task: () => Promise<T>) => Promise<T>;
  /** The browser's real user agent, read once at launch, without the headless marker. */
  userAgent: string;
  close(): Promise<void>;
}

/** Open the saved browser profile. Only one session may be open at a time. */
export async function openSession(options: { headless: boolean }): Promise<Session> {
  mkdirSync(PROFILE_DIR, { recursive: true });
  const release = acquireLock(LOCK_FILE);
  try {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: options.headless,
      viewport: null,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return {
      context,
      queue: createQueue(MIN_INTERVAL_MS),
      userAgent: (await page.evaluate(() => navigator.userAgent)).replace("HeadlessChrome", "Chrome"),
      async close() {
        await context.close();
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}

/** Open a visible browser on the LinkedIn login page and wait until the user reaches the feed. */
export async function login(): Promise<void> {
  const session = await openSession({ headless: false });
  try {
    const page = session.context.pages()[0] ?? (await session.context.newPage());
    await page.goto("https://www.linkedin.com/login");
    console.log("Sign in to LinkedIn in the browser window. Waiting up to 5 minutes...");
    await page.waitForURL(/linkedin\.com\/feed/, { timeout: 5 * 60_000 });
    console.log(`Signed in. Session saved in ${PROFILE_DIR}`);
  } finally {
    await session.close();
  }
}

/** Check the saved session against Voyager `/me` and print who it belongs to. */
export async function status(): Promise<void> {
  const session = await openSession({ headless: true });
  try {
    const me = await getMe(createVoyager(session));
    console.log(`Signed in as ${me.name} (${me.publicId})`);
  } finally {
    await session.close();
  }
}
