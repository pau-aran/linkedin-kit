import { expect, test } from "bun:test";
import type { LiClient, LiOptions } from "./client.ts";
import { runLiScript } from "./run.ts";

function fakeClient() {
  let closed = false;
  const unused = () => {
    throw new Error("Unexpected client call");
  };
  return {
    isClosed: () => closed,
    async createLi({ allowWrite }: LiOptions): Promise<LiClient> {
      return {
        profile: {
          get: unused,
          async updateHeadline(headline) {
            if (closed) throw new Error("Client already closed");
            return { applied: allowWrite, before: "old headline", after: headline };
          },
          updateAbout: unused,
          updateLocation: unused,
          addPosition: unused,
          editPosition: unused,
          removePosition: unused,
          addEducation: unused,
          editEducation: unused,
          removeEducation: unused,
          addSkill: unused,
          removeSkill: unused,
        },
        jobs: { search: unused, get: unused, saved: unused },
        async close() {
          closed = true;
        },
      };
    },
  };
}

test.each([false, true])("runs a TypeScript body and closes the client (allowWrite: %s)", async (allowWrite) => {
  const client = fakeClient();
  const result = await runLiScript(`
    const headline: string = "new headline";
    return await li.profile.updateHeadline(headline);
  `, { allowWrite }, client.createLi);

  expect(result).toEqual({
    ok: true,
    value: { applied: allowWrite, before: "old headline", after: "new headline" },
  });
  expect(client.isClosed()).toBe(true);
});

test("reports an async script error and still closes the client", async () => {
  const client = fakeClient();
  const result = await runLiScript(`
    await li.profile.updateHeadline("new headline");
    throw new Error("script failed");
  `, { allowWrite: false }, client.createLi);

  expect(result).toEqual({ ok: false, error: new Error("script failed") });
  expect(client.isClosed()).toBe(true);
});
