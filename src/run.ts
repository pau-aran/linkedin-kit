import type { LiClient, LiOptions } from "./client.ts";

type ScriptResult = { ok: true; value: unknown } | { ok: false; error: unknown };

/** Run a trusted TypeScript function body with `li` in scope and close its client on exit. */
export async function runLiScript(
  source: string,
  options: LiOptions,
  createLi: (options: LiOptions) => Promise<LiClient>,
): Promise<ScriptResult> {
  try {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const body = transpiler.transformSync(`return (async (li) => {\n${source}\n})(li);`);
    const execute = new Function("li", body);
    const li = await createLi(options);
    let result: ScriptResult;
    try {
      const value: unknown = await execute(li);
      result = { ok: true, value };
    } catch (error) {
      result = { ok: false, error };
    }
    try {
      await li.close();
    } catch (error) {
      return {
        ok: false,
        error: result.ok ? error : new AggregateError([result.error, error], "Script and client cleanup failed"),
      };
    }
    return result;
  } catch (error) {
    return { ok: false, error };
  }
}
