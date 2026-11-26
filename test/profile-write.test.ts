import { afterAll, beforeAll, expect, test } from "bun:test";
import { createProfileWrites } from "../src/profile-write.ts";
import { dryRunDeps, fixtureVoyager, formBrowser } from "./form-browser.ts";

const BROWSER_TIMEOUT = 30_000;

let browser: Awaited<ReturnType<typeof formBrowser>>;

beforeAll(async () => {
  browser = await formBrowser({
    "/in/ada-lovelace/edit/intro/": "intro.html",
    "/in/ada-lovelace/edit/forms/summary/new": "summary.html",
  });
});

afterAll(() => browser.close());

function live() {
  browser.saves.length = 0;
  browser.visited.length = 0;
  return createProfileWrites({
    voyager: fixtureVoyager(),
    queue: (task) => task(),
    newPage: browser.newPage,
    allowWrite: true,
  });
}

test("without allowWrite a write is a dry run that shows the change", async () => {
  const writes = createProfileWrites(dryRunDeps());
  expect(await writes.updateHeadline("Staff engineer")).toEqual({
    applied: false,
    before: "Platform engineer",
    after: "Staff engineer",
  });
});

test("a headline over LinkedIn's limit is refused, even in a dry run", async () => {
  const writes = createProfileWrites(dryRunDeps());
  await expect(writes.updateHeadline("x".repeat(221))).rejects.toThrow(/limit is 220/);
});

test(
  "updateHeadline fills the intro form and saves",
  async () => {
    expect(await live().updateHeadline("Staff engineer")).toEqual({
      applied: true,
      before: "Platform engineer",
      after: "Staff engineer",
    });
    expect(browser.saves).toEqual([{ textbox: "Staff engineer", Industry: "Software Development", City: "Madrid" }]);
  },
  BROWSER_TIMEOUT,
);

test(
  "updateAbout keeps line breaks",
  async () => {
    const result = await live().updateAbout("Line one.\nLine two.");
    expect(result).toMatchObject({ applied: true, before: "I build platforms." });
    expect(browser.saves).toEqual([{ textbox: "Line one.\nLine two." }]);
  },
  BROWSER_TIMEOUT,
);

test(
  "updateLocation picks the City suggestion",
  async () => {
    const result = await live().updateLocation("Barcelona");
    expect(result).toEqual({ applied: true, before: "Barcelona, Catalonia, Spain", after: "Barcelona" });
    expect(browser.saves[0]).toMatchObject({ City: "Barcelona" });
  },
  BROWSER_TIMEOUT,
);
