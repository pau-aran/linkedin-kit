import { expect, test } from "bun:test";
import { getProfile, readProfile } from "../src/profile.ts";
import type { Voyager } from "../src/voyager.ts";
import dashProfile from "./fixtures/dash-profile.json";
import me from "./fixtures/me.json";

const fixtures: Record<string, unknown> = { "/me": me, "/identity/dash/profiles": dashProfile };
const voyager: Voyager = { get: async (path) => fixtures[path] };

test("profile.get maps my Voyager profile to the Profile type", async () => {
  expect(await getProfile(voyager)).toEqual({
    publicId: "ada-lovelace",
    name: "Ada Lovelace",
    headline: "Platform engineer",
    about: "I build platforms.",
    location: "Barcelona, Catalonia, Spain",
    experience: [
      {
        title: "Platform engineer",
        company: "Babbage Ltd",
        location: "Remote",
        start: "2022-01",
        description: "Kubernetes and CI.",
      },
      { title: "Engineer", company: "Analytical Engines", start: "2019-03", end: "2021-12" },
    ],
    education: [
      { school: "University of London", degree: "BSc", field: "Mathematics", start: "2014", end: "2018" },
    ],
    skills: ["Kubernetes", "TypeScript"],
  });
});

test("readProfile gives each entry's LinkedIn id, index for index", async () => {
  const { positionIds, educationIds } = await readProfile(voyager);
  expect(positionIds).toEqual(["2", "1"]);
  expect(educationIds).toEqual(["1"]);
});
