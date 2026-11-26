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

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

/**
 * A Voyager client whose every request goes through `queue`. Cookies come from the browser
 * context; responses never write cookies back, so a redirect to /login cannot clobber `li_at`.
 */
export function createVoyager(
  context: Pick<BrowserContext, "cookies">,
  queue: <T>(task: () => Promise<T>) => Promise<T>,
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
            "user-agent": USER_AGENT,
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
