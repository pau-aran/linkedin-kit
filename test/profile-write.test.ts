import { afterAll, beforeAll, expect, test } from "bun:test";
import { createProfileWrites } from "../src/profile-write.ts";
import type { Voyager } from "../src/voyager.ts";
import dashProfile from "./fixtures/dash-profile.json";
import { dryRunDeps, fixtureVoyager, formBrowser } from "./form-browser.ts";

const BROWSER_TIMEOUT = 30_000;

let browser: Awaited<ReturnType<typeof formBrowser>>;

beforeAll(async () => {
  browser = await formBrowser({
    "/in/ada-lovelace/edit/intro/": "intro.html",
    "/in/ada-lovelace/edit/forms/summary/new": "summary.html",
    "/in/ada-lovelace/edit/forms/position/new": "position.html",
    "/in/ada-lovelace/edit/forms/position/1": "position.html",
    "/in/ada-lovelace/edit/forms/education/new": "education.html",
    "/in/ada-lovelace/edit/forms/education/1": "education.html",
  });
});

afterAll(() => browser.close());

function live(voyager: Voyager = fixtureVoyager()) {
  browser.saves.length = 0;
  browser.visited.length = 0;
  return createProfileWrites({
    voyager,
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

test(
  "addPosition fills a current position and does not notify the network",
  async () => {
    const position = {
      title: "Staff engineer",
      company: "Difference Engines",
      location: "Barcelona",
      start: "2025-02",
      description: "Platform team.",
    };
    expect(await live().addPosition(position)).toEqual({ applied: true, before: null, after: position });
    expect(browser.saves).toEqual([
      {
        Title: "Staff engineer",
        "Employment type": "Please select",
        "Company or organization": "Difference Engines",
        "I am currently working in this role": true,
        "Start date month": "February",
        "Start date year": "2025",
        Location: "Barcelona",
        "Location type": "Please select",
        Description: "Platform team.",
        "Notify network": false,
      },
    ]);
  },
  BROWSER_TIMEOUT,
);

test(
  "editPosition opens the entry's own form and fills only the patched fields",
  async () => {
    const result = await live().editPosition(1, { end: "2022-06" });
    expect(result).toEqual({
      applied: true,
      before: { title: "Engineer", company: "Analytical Engines", start: "2019-03", end: "2021-12" },
      after: { title: "Engineer", company: "Analytical Engines", start: "2019-03", end: "2022-06" },
    });
    expect(browser.visited).toEqual(["/in/ada-lovelace/edit/forms/position/1"]);
    expect(browser.saves[0]).toMatchObject({
      Title: "",
      "I am currently working in this role": false,
      "End date month": "June",
      "End date year": "2022",
    });
  },
  BROWSER_TIMEOUT,
);

test("editing an entry that does not exist is refused, even in a dry run", async () => {
  await expect(createProfileWrites(dryRunDeps()).editPosition(5, { title: "x" })).rejects.toThrow(
    /no experience entry at index 5; the profile has 2/,
  );
});

test(
  "removePosition deletes through the confirm dialog and checks the entry is gone",
  async () => {
    const withoutEntry = {
      ...dashProfile,
      included: dashProfile.included.filter((e) => e.entityUrn !== "urn:li:fsd_profilePosition:(ACoAAAexample,1)"),
    };
    const deletesBefore = browser.deletes();
    const voyager = fixtureVoyager();
    const afterDelete: Voyager = {
      get: async (path, query) =>
        path === "/identity/dash/profiles" && browser.deletes() > deletesBefore ? withoutEntry : voyager.get(path, query),
    };
    const result = await live(afterDelete).removePosition(1);
    expect(result).toEqual({
      applied: true,
      before: { title: "Engineer", company: "Analytical Engines", start: "2019-03", end: "2021-12" },
      after: null,
    });
    expect(browser.deletes()).toBe(deletesBefore + 1);
  },
  BROWSER_TIMEOUT,
);

test(
  "removePosition fails when the entry is still on the profile afterwards",
  async () => {
    await expect(live().removePosition(1)).rejects.toThrow(/still on the profile; nothing was deleted/);
  },
  BROWSER_TIMEOUT,
);

test(
  "addEducation fills school, degree, field and years",
  async () => {
    const education = { school: "ETH Zurich", degree: "MSc", field: "Computer Science", start: "2018", end: "2020" };
    expect(await live().addEducation(education)).toMatchObject({ applied: true, after: education });
    expect(browser.saves[0]).toMatchObject({
      School: "ETH Zurich",
      Degree: "MSc",
      "Field of study": "Computer Science",
      "Start date year": "2018",
      "End date (or expected) year": "2020",
      "Start date month": "Month",
      "Notify network": false,
    });
  },
  BROWSER_TIMEOUT,
);
