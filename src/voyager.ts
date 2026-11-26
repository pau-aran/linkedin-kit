// Ported from Sabari2005/linkedin-mcp-server, src/voyager/client.ts and src/auth/session.ts.
// Copyright (c) 2026 Sabari Vadivelan S. MIT License; see NOTICE.
//
// Voyager is LinkedIn's internal JSON API at /voyager/api. Requests run through the
// browser context, so they carry the session cookies; the CSRF token is the JSESSIONID value.

import type { BrowserContext } from "patchright";

const BASE = "https://www.linkedin.com";

export type VoyagerQuery = Record<string, string | number | boolean | undefined>;

export interface Voyager {
  get(path: string, query?: VoyagerQuery): Promise<unknown>;
}

/** Serialise query params, keeping Rest.li structure such as `List(a,b)`, `(a:b)` and URNs literal. */
export function buildQuery(query: VoyagerQuery = {}): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const text = String(value);
    // LinkedIn's Rest.li syntax uses (),: and , structurally; encoding them breaks it.
    const encoded = /^(List\(|\(|urn:)/.test(text) ? text.replace(/ /g, "%20") : encodeURIComponent(text);
    parts.push(`${key}=${encoded}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export interface VoyagerSession {
  context: Pick<BrowserContext, "cookies">;
  queue: <T>(task: () => Promise<T>) => Promise<T>;
  /** The browser's own user agent, so requests match the browser that owns the cookies. */
  userAgent: string;
}

/**
 * A Voyager client whose every request goes through the session queue. Cookies come from the browser
 * context; responses never write cookies back, so a redirect to /login cannot clobber `li_at`.
 */
export function createVoyager(
  { context, queue, userAgent }: VoyagerSession,
  fetchFn: typeof fetch = fetch,
): Voyager {
  return {
    get: (path, query) =>
      queue(async () => {
        const cookies = await context.cookies(BASE);
        const jsession = cookies.find((c) => c.name === "JSESSIONID")?.value;
        if (!jsession || !cookies.some((c) => c.name === "li_at")) {
          throw new Error("lk: not signed in; run `lk login`");
        }
        const res = await fetchFn(`${BASE}/voyager/api${path}${buildQuery(query)}`, {
          redirect: "manual",
          headers: {
            cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
            "csrf-token": jsession.replace(/"/g, ""),
            accept: "application/vnd.linkedin.normalized+json+2.1",
            "x-restli-protocol-version": "2.0.0",
            "x-li-lang": "en_US",
            "user-agent": userAgent,
            referer: `${BASE}/feed/`,
            origin: BASE,
            "accept-language": "en-US,en;q=0.9",
          },
        });
        if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
          throw new Error(`lk: LinkedIn rejected the session (HTTP ${res.status} on ${path}); run \`lk login\``);
        }
        if (res.status === 429) throw new Error(`lk: LinkedIn rate limit hit (HTTP 429 on ${path}); retry later`);
        if (!res.ok) throw new Error(`lk: Voyager HTTP ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
        return res.json();
      }),
  };
}

export interface Me {
  publicId: string;
  name: string;
}

/** Who the session is signed in as, from Voyager `/me`. */
export async function getMe(voyager: Voyager): Promise<Me> {
  const res = (await voyager.get("/me")) as { included?: Array<Record<string, unknown>> };
  const mini = res.included?.find((e) => typeof e.publicIdentifier === "string");
  if (!mini) throw new Error("lk: Voyager /me returned no profile");
  return {
    publicId: String(mini.publicIdentifier),
    name: [mini.firstName, mini.lastName].filter((s) => typeof s === "string" && s).join(" "),
  };
}

/* ── Normalized-JSON decoding ─────────────────────────────────────────────── */

/**
 * `application/vnd.linkedin.normalized+json` flattens an object graph into a
 * flat `included[]` array where cross-references are URN strings and keys are
 * prefixed with `*`.
 */
export class VoyagerGraph {
  private byUrn = new Map<string, Record<string, unknown>>();
  readonly included: Array<Record<string, unknown>>;

  constructor(response: unknown) {
    const res = (response ?? {}) as { included?: Array<Record<string, unknown>> };
    this.included = Array.isArray(res.included) ? res.included : [];
    for (const entity of this.included) {
      for (const key of ["entityUrn", "dashEntityUrn", "objectUrn"]) {
        const urn = entity[key];
        if (typeof urn === "string" && !this.byUrn.has(urn)) this.byUrn.set(urn, entity);
      }
    }
  }

  resolve(urn: unknown): Record<string, unknown> | undefined {
    return typeof urn === "string" ? this.byUrn.get(urn) : undefined;
  }

  /** All included entities whose $type ends with the given name. */
  byType(typeSuffix: string): Array<Record<string, unknown>> {
    const suffix = typeSuffix.toLowerCase();
    return this.included.filter((e) => typeof e.$type === "string" && e.$type.toLowerCase().endsWith(suffix));
  }
}

/* ── Field access helpers ─────────────────────────────────────────────────── */

/** Safely read a nested path: pick(obj, 'a.b.c'). */
export function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** First non-empty string at any of the paths. LinkedIn wraps many strings as { text: "…" }. */
export function pickString(obj: unknown, ...paths: string[]): string | undefined {
  for (const p of paths) {
    const v = pick(obj, p);
    const text = typeof v === "string" ? v : pick(v, "text");
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return undefined;
}

/** LinkedIn date objects: { year, month } → "YYYY-MM" (or "YYYY"). */
export function formatLinkedInDate(d: unknown): string | undefined {
  const year = pick(d, "year");
  if (typeof year !== "number") return undefined;
  const month = pick(d, "month");
  return typeof month === "number" ? `${year}-${String(month).padStart(2, "0")}` : String(year);
}
