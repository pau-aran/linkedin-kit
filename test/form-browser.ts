// A headless browser whose linkedin.com is served from test/fixtures/forms. Nothing reaches LinkedIn.

import { chromium } from "patchright";
import type { ProfileWriteDeps } from "../src/profile-write.ts";
import type { Voyager } from "../src/voyager.ts";
import dashProfile from "./fixtures/dash-profile.json";
import me from "./fixtures/me.json";

const FIXTURES = new URL("./fixtures/forms/", import.meta.url);

/** Serves `pages[pathname]` from the form fixtures and records what the forms submit. */
export async function formBrowser(pages: Record<string, string>) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const saves: Record<string, unknown>[] = [];
  const visited: string[] = [];
  const deleted: string[] = [];
  await context.route("https://www.linkedin.com/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/__save") {
      saves.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    }
    if (pathname === "/__delete") {
      deleted.push(route.request().postData() ?? "");
      return route.fulfill({ status: 204 });
    }
    const file = pathname.startsWith("/__fixtures/") ? pathname.slice("/__fixtures/".length) : pages[pathname];
    if (!file) return route.fulfill({ status: 404, body: `no fixture for ${pathname}` });
    if (!pathname.startsWith("/__fixtures/")) visited.push(pathname);
    return route.fulfill({ path: new URL(file, FIXTURES).pathname });
  });
  return {
    saves,
    visited,
    deleted,
    newPage: () => context.newPage(),
    close: () => browser.close(),
  };
}

/** A Voyager that answers from the recorded profile fixtures. */
export function fixtureVoyager(responses: Record<string, unknown> = {}): Voyager {
  const all: Record<string, unknown> = { "/me": me, "/identity/dash/profiles": dashProfile, ...responses };
  return { get: async (path) => all[path] };
}

/** Write deps for a dry run: opening a page fails the test. */
export function dryRunDeps(voyager: Voyager = fixtureVoyager()): ProfileWriteDeps {
  return {
    voyager,
    queue: (task) => task(),
    newPage: () => Promise.reject(new Error("a dry run must not open a page")),
    allowWrite: false,
  };
}
