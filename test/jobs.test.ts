import { expect, test } from "bun:test";
import { createVoyagerJobs } from "../src/jobs.ts";
import { buildQuery } from "../src/voyager.ts";
import detail from "./fixtures/job-detail.json";
import saved from "./fixtures/jobs-saved.json";
import search from "./fixtures/jobs-search.json";

const firstJob = {
  id: "42",
  title: "Platform engineer",
  company: "Babbage Ltd",
  location: "Spain (Remote)",
  postedAt: "2024-01-01T00:00:00.000Z",
  url: "https://www.linkedin.com/jobs/view/42/",
};

test("jobs.search sends its filters safely and returns ordered, unique posting cards across pages", async () => {
  const offsets: unknown[] = [];
  const jobs = createVoyagerJobs({
    async get(path, query) {
      expect(path).toBe("/voyagerJobsDashJobCards");
      expect(query?.q).toBe("jobSearch");
      expect(query?.count).toBe(25);
      expect(buildQuery(query)).toContain(
        "&query=(origin:JOB_SEARCH_PAGE_JOB_FILTER,keywords:C%2B%2B%20%28SRE%29%20%26%20Ops," +
        "locationUnion:(seoLocation:(location:Barcelona%2C%20Spain))," +
        "selectedFilters:(workplaceType:List(2),timePostedRange:List(r604800),experience:List(3,4)),spellCorrectionEnabled:true)",
      );
      offsets.push(query?.start);
      if (query?.start === 0) return search;
      return {
        data: {
          paging: { start: 25, count: 25, total: 27 },
          elements: [search.data.elements[0], { jobCardUnion: { "*jobPostingCard": "urn:li:fsd_jobPostingCard:(15,JOBS_SEARCH)" } }],
        },
        included: [...search.included, {
          entityUrn: "urn:li:fsd_jobPostingCard:(15,JOBS_SEARCH)",
          "*jobPosting": "urn:li:fsd_jobPosting:15",
          title: { text: "SRE" },
          primaryDescription: { text: "Analytical Engines" },
          secondaryDescription: { text: "Madrid" },
        }],
      };
    },
  });

  expect(await jobs.search({
    keywords: "C++ (SRE) & Ops",
    location: "Barcelona, Spain",
    remote: "remote",
    postedWithin: "week",
    experience: ["associate", "mid-senior"],
    limit: 26,
  })).toEqual([
    firstJob,
    { id: "15", title: "SRE", company: "Analytical Engines", location: "Madrid", url: "https://www.linkedin.com/jobs/view/15/" },
  ]);
  expect(offsets).toEqual([0, 25]);
});

test("jobs.get maps the posting, including its linked company and optional details", async () => {
  const jobs = createVoyagerJobs({
    async get(path) {
      expect(path).toBe("/jobs/jobPostings/42");
      return detail;
    },
  });

  expect(await jobs.get("42")).toEqual({
    ...firstJob,
    location: "Spain",
    description: "Design and run reliable services.\nExperience with Kubernetes required.",
    skills: ["Kubernetes", "Incident response"],
    employmentType: "Full-time",
    seniority: "Mid-Senior level",
    workplace: "hybrid",
    applicants: 7,
  });
});

test("jobs.saved requests the SAVED tab and resolves its job cards without tracking URLs", async () => {
  const jobs = createVoyagerJobs({
    async get(path, query) {
      expect(path).toBe("/graphql");
      expect(query?.variables).toBe(
        "(start:0,query:(flagshipSearchIntent:SEARCH_MY_ITEMS_JOB_SEEKER,queryParameters:List((key:cardType,value:List(SAVED)))))",
      );
      return saved;
    },
  });

  expect(await jobs.saved()).toEqual([
    { id: "77", title: "Systems engineer", company: "Analytical Engines", location: "Madrid", url: "https://www.linkedin.com/jobs/view/77/" },
  ]);
});

test("jobs.saved distinguishes an empty tab from a GraphQL error", async () => {
  const empty = createVoyagerJobs({ get: async () => ({ data: { data: { searchDashClustersByAll: { elements: [] } } } }) });
  const failed = createVoyagerJobs({ get: async () => ({ errors: [{ message: "Unknown query ID" }] }) });

  expect(await empty.saved()).toEqual([]);
  await expect(failed.saved()).rejects.toThrow("no result collection for saved jobs");
});
