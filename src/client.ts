import type { Li } from "./li.ts";

export interface LiOptions {
  /** Profile writes are sent only when true (`lk run --write`). */
  allowWrite: boolean;
}

/** A live client backed by the saved browser session. Call `close()` when done. */
export interface LiClient extends Li {
  close(): Promise<void>;
}

export async function createLi(_options: LiOptions): Promise<LiClient> {
  throw new Error("createLi: not implemented yet");
}
