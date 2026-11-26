// Ported from Sabari2005/linkedin-mcp-server, src/domains/profile.ts.
// Copyright (c) 2026 Sabari Vadivelan S. MIT License; see NOTICE.

import type { Education, Position, Profile } from "./li.ts";
import { VoyagerGraph, formatLinkedInDate, getMe, pick, pickString, type Voyager } from "./voyager.ts";

/**
 * The `identity/dash/profiles` finder with this decoration returns the whole
 * profile graph (top card plus every section) in one request. The legacy
 * `/identity/profiles/{id}/profileView` endpoint answers HTTP 410 Gone.
 */
const PROFILE_DECORATION = "com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101";

/** My own profile, read from Voyager. */
export async function getProfile(voyager: Voyager): Promise<Profile> {
  const me = await getMe(voyager);
  const graph = new VoyagerGraph(
    await voyager.get("/identity/dash/profiles", {
      q: "memberIdentity",
      memberIdentity: me.publicId,
      decorationId: PROFILE_DECORATION,
    }),
  );
  const entity = graph.byType("identity.profile.Profile").find((p) => p.publicIdentifier === me.publicId);
  if (!entity) throw new Error(`lk: Voyager returned no profile for ${me.publicId}`);

  const geo = graph.resolve(pick(entity, "geoLocation.*geo"));
  return {
    publicId: me.publicId,
    name: [pickString(entity, "firstName"), pickString(entity, "lastName")].filter(Boolean).join(" "),
    headline: pickString(entity, "headline") ?? "",
    about: pickString(entity, "summary") ?? "",
    location: pickString(geo, "defaultLocalizedName") ?? pickString(entity, "geoLocationName", "locationName") ?? "",
    experience: newestFirst(graph.byType("identity.profile.Position").map(decodePosition)),
    education: newestFirst(graph.byType("identity.profile.Education").map(decodeEducation)),
    skills: graph.byType("identity.profile.Skill").flatMap((s) => pickString(s, "name") ?? []),
  };
}

function decodePosition(e: Record<string, unknown>): Position {
  return compact<Position>({
    title: pickString(e, "title") ?? "",
    company: pickString(e, "companyName", "company.name") ?? "",
    location: pickString(e, "locationName", "geoLocationName"),
    start: formatLinkedInDate(pick(e, "dateRange.start")),
    end: formatLinkedInDate(pick(e, "dateRange.end")),
    description: pickString(e, "description"),
  });
}

function decodeEducation(e: Record<string, unknown>): Education {
  return compact<Education>({
    school: pickString(e, "schoolName", "school.name") ?? "",
    degree: pickString(e, "degreeName"),
    field: pickString(e, "fieldOfStudy"),
    start: formatLinkedInDate(pick(e, "dateRange.start")),
    end: formatLinkedInDate(pick(e, "dateRange.end")),
    description: pickString(e, "description"),
  });
}

/** Voyager does not order `included`; LinkedIn shows entries by start date, newest first. */
function newestFirst<T extends { start?: string }>(entries: T[]): T[] {
  return entries.toSorted((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
}

/** Drop undefined fields, so optional fields are absent rather than undefined. */
function compact<T extends object>(fields: { [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as T;
}
