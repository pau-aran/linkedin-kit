// Ported from Sabari2005/linkedin-mcp-server, src/domains/jobs.ts.
// Copyright (c) 2026 Sabari Vadivelan S. MIT License; see NOTICE.

import type { JobDetail, JobSearchQuery, JobSummary, Li } from "./li.ts";
import { pick, pickString, VoyagerGraph, type Voyager } from "./voyager.ts";

const SEARCH_DECORATION = "com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-220";
const DETAIL_DECORATION = "com.linkedin.voyager.deco.jobs.web.shared.WebFullJobPosting-65";
const SAVED_QUERY_ID = "voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0";

const workplaceCodes = { onsite: "1", remote: "2", hybrid: "3" } as const;
const experienceCodes = { internship: "1", entry: "2", associate: "3", "mid-senior": "4", director: "5", executive: "6" } as const;
const postedWithinCodes = { day: "r86400", week: "r604800", month: "r2592000" } as const;

/** Read job search results, postings, and saved jobs through the shared Voyager session. */
export function createVoyagerJobs(voyager: Voyager): Li["jobs"] {
  return {
    search: (query) => searchJobs(voyager, query),
    get: (id) => getJob(voyager, id),
    saved: () => getSavedJobs(voyager),
  };
}

async function searchJobs(voyager: Voyager, query: JobSearchQuery): Promise<JobSummary[]> {
  const limit = Math.min(Math.trunc(query.limit ?? 25), 200);
  if (!(limit > 0)) return [];
  const count = Math.min(limit, 25);
  const filters = [
    query.remote && `workplaceType:List(${workplaceCodes[query.remote]})`,
    query.postedWithin && `timePostedRange:List(${postedWithinCodes[query.postedWithin]})`,
    query.experience?.length && `experience:List(${[...new Set(query.experience.map((level) => experienceCodes[level]))].join(",")})`,
  ].filter(Boolean);
  const location = query.location && `locationUnion:(seoLocation:(location:${encodeRestLiValue(query.location)}))`;
  const fields = [
    "origin:JOB_SEARCH_PAGE_JOB_FILTER",
    query.keywords && `keywords:${encodeRestLiValue(query.keywords)}`,
    location,
    filters.length && `selectedFilters:(${filters.join(",")})`,
    "spellCorrectionEnabled:true",
  ].filter(Boolean);
  return collectJobs(limit, count, async (start) => {
    const response = await voyager.get("/voyagerJobsDashJobCards", {
      decorationId: SEARCH_DECORATION,
      q: "jobSearch",
      query: `(${fields.join(",")})`,
      count,
      start,
    });
    const page = pick(response, "data");
    const graph = new VoyagerGraph(response);
    const jobs = jobRows(page, "search").flatMap((row) => {
      const card = graph.resolve(pick(row, "jobCardUnion.*jobPostingCard"));
      const listed = list(pick(card, "footerItems")).find((item) => pick(item, "type") === "LISTED_DATE");
      return jobSummary(
        postingId(pickString(card, "jobPostingUrn", "*jobPosting")),
        pickString(card, "title", "jobPostingTitle"),
        pickString(card, "primaryDescription"),
        pickString(card, "secondaryDescription"),
        postedDate(pick(listed, "timeAt")),
      ) ?? [];
    });
    return { jobs, total: pick(page, "paging.total") };
  });
}

function getSavedJobs(voyager: Voyager): Promise<JobSummary[]> {
  return collectJobs(50, 10, async (start) => {
    const response = await voyager.get("/graphql", {
      variables: `(start:${start},query:(flagshipSearchIntent:SEARCH_MY_ITEMS_JOB_SEEKER,queryParameters:List((key:cardType,value:List(SAVED)))))`,
      queryId: SAVED_QUERY_ID,
    });
    const page = pick(response, "data.data.searchDashClustersByAll");
    const graph = new VoyagerGraph(response);
    const jobs = jobRows(page, "saved jobs").flatMap((cluster) => list(pick(cluster, "items"))).flatMap((row) => {
      const result = graph.resolve(pick(row, "item.*entityResult"));
      const url = pickString(result, "navigationUrl") ?? "";
      return jobSummary(
        postingId(pickString(result, "trackingUrn")) ?? /\/jobs\/view\/(\d+)(?:[/?#]|$)/.exec(url)?.[1],
        pickString(result, "title"),
        pickString(result, "primarySubtitle"),
        pickString(result, "secondarySubtitle"),
      ) ?? [];
    });
    return { jobs, total: pick(page, "paging.total") };
  });
}

async function getJob(voyager: Voyager, id: string): Promise<JobDetail> {
  if (!/^\d+$/.test(id)) throw new Error("lk: li.jobs.get expects a numeric job ID");
  const response = await voyager.get(`/jobs/jobPostings/${id}`, { decorationId: DETAIL_DECORATION });
  const posting = pick(response, "data");
  const graph = new VoyagerGraph(response);
  const company = graph.resolve(pickString(posting, "companyDetails.*companyResolutionResult", "companyDetails.company"));
  const summary = jobSummary(
    id,
    pickString(posting, "title"),
    pickString(company, "name") ?? pickString(posting, "companyDetails.companyName"),
    pickString(posting, "formattedLocation"),
    postedDate(pick(posting, "listedAt")),
  );
  if (!summary) throw new Error(`lk: Voyager returned no job posting for ${id}`);

  const type = list(pick(posting, "workplaceTypes"))[0];
  const workplace = (["onsite", "remote", "hybrid"] as const)
    .find((mode) => type === `urn:li:fs_workplaceType:${workplaceCodes[mode]}`)
    ?? (pick(posting, "workRemoteAllowed") === true ? "remote" : undefined);
  const seniority = pickString(posting, "formattedExperienceLevel");
  const employmentType = pickString(posting, "formattedEmploymentStatus");
  const applicants = pick(posting, "applies");
  const skills = list(pick(posting, "skills")).flatMap((skill) => pickString({ skill }, "skill", "skill.name") ?? []);
  return {
    ...summary,
    description: pickString(posting, "description") ?? "",
    skills,
    ...(seniority && { seniority }),
    ...(employmentType && { employmentType }),
    ...(workplace && { workplace }),
    ...(typeof applicants === "number" && { applicants }),
  };
}

async function collectJobs(
  limit: number,
  count: number,
  readPage: (start: number) => Promise<{ jobs: JobSummary[]; total: unknown }>,
): Promise<JobSummary[]> {
  const seen = new Map<string, JobSummary>();
  // An offset cap also bounds requests if LinkedIn repeats or reorders promoted jobs.
  for (let start = 0; start < limit; start += count) {
    const { jobs, total } = await readPage(start);
    for (const job of jobs) {
      if (!seen.has(job.id)) seen.set(job.id, job);
      if (seen.size === limit) return [...seen.values()];
    }
    if (jobs.length === 0 || typeof total !== "number" || start + count >= total) break;
  }
  return [...seen.values()];
}

function jobRows(page: unknown, operation: string): unknown[] {
  const rows = pick(page, "elements");
  if (!Array.isArray(rows)) throw new Error(`lk: Voyager returned no result collection for ${operation}`);
  return rows;
}

function jobSummary(id: string | undefined, title: string | undefined, company = "", location = "", postedAt?: string): JobSummary | undefined {
  if (!id || !title) return undefined;
  return { id, title, company, location, url: `https://www.linkedin.com/jobs/view/${id}/`, ...(postedAt && { postedAt }) };
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function postedDate(value: unknown): string | undefined {
  if (typeof value !== "number" || value <= 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function postingId(urn: string | undefined): string | undefined {
  return /^urn:li:fsd_jobPosting:(\d+)$/.exec(urn ?? "")?.[1];
}

/** Escape scalar input, not the surrounding Rest.li tuple delimiters. */
function encodeRestLiValue(value: string): string {
  return encodeURIComponent(value).replaceAll("(", "%28").replaceAll(")", "%29");
}
