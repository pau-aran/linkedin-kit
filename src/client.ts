import { createVoyagerJobs } from "./jobs.ts";
import type { Li } from "./li.ts";
import { getProfile } from "./profile.ts";
import { createProfileWrites } from "./profile-write.ts";
import { openSession } from "./session.ts";
import { createVoyager } from "./voyager.ts";

export interface LiOptions {
  /** Profile writes are sent only when true (`lk run --write`). */
  allowWrite: boolean;
}

/** A live client backed by the saved browser session. Call `close()` when done. */
export interface LiClient extends Li {
  close(): Promise<void>;
}

const notImplemented = (name: string) => async (): Promise<never> => {
  throw new Error(`li.${name}: not implemented yet`);
};

export async function createLi(options: LiOptions): Promise<LiClient> {
  const session = await openSession({ headless: true });
  const voyager = createVoyager(session);
  const writes = createProfileWrites({
    voyager,
    queue: session.queue,
    newPage: () => session.context.newPage(),
    allowWrite: options.allowWrite,
  });
  return {
    profile: {
      get: () => getProfile(voyager),
      ...writes,
      addPosition: notImplemented("profile.addPosition"),
      editPosition: notImplemented("profile.editPosition"),
      removePosition: notImplemented("profile.removePosition"),
      addEducation: notImplemented("profile.addEducation"),
      editEducation: notImplemented("profile.editEducation"),
      removeEducation: notImplemented("profile.removeEducation"),
      addSkill: notImplemented("profile.addSkill"),
      removeSkill: notImplemented("profile.removeSkill"),
    },
    jobs: createVoyagerJobs(voyager),
    close: () => session.close(),
  };
}
