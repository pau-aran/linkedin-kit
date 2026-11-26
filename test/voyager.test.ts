import { expect, test } from "bun:test";
import { buildQuery, createVoyager, getMe } from "../src/voyager.ts";
import me from "./fixtures/me.json";

const signedIn = { cookies: async () => [cookie("li_at", "token"), cookie("JSESSIONID", '"ajax:42"')] };
const direct = <T>(task: () => Promise<T>) => task();

function cookie(name: string, value: string) {
  return { name, value, domain: ".linkedin.com", path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "None" as const };
}

function fakeFetch(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("requests carry the session cookies and the csrf token from JSESSIONID", async () => {
  const { fn, calls } = fakeFetch(Response.json({ ok: 1 }));
  const voyager = createVoyager(signedIn, direct, fn);
  expect(await voyager.get("/identity/dash/profiles", { q: "memberIdentity", memberIdentity: "ada" })).toEqual({ ok: 1 });
  expect(calls[0]!.url).toBe("https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=ada");
  const headers = calls[0]!.init.headers as Record<string, string>;
  expect(headers["csrf-token"]).toBe("ajax:42");
  expect(headers.cookie).toBe('li_at=token; JSESSIONID="ajax:42"');
});

test("a redirect means the session was rejected", async () => {
  const { fn } = fakeFetch(new Response(null, { status: 302, headers: { location: "/login" } }));
  await expect(createVoyager(signedIn, direct, fn).get("/me")).rejects.toThrow(/rejected the session.*lk login/);
});

test("without session cookies no request is sent", async () => {
  const { fn, calls } = fakeFetch(Response.json({}));
  await expect(createVoyager({ cookies: async () => [] }, direct, fn).get("/me")).rejects.toThrow(/not signed in/);
  expect(calls).toHaveLength(0);
});

test("Rest.li values stay literal in the query", () => {
  expect(buildQuery({ a: "List(x,y)", b: "a b&c", c: undefined })).toBe("?a=List(x,y)&b=a%20b%26c");
});

test("getMe reads the signed-in member from /me", async () => {
  const { fn } = fakeFetch(Response.json(me));
  expect(await getMe(createVoyager(signedIn, direct, fn))).toEqual({ publicId: "ada-lovelace", name: "Ada Lovelace" });
});
