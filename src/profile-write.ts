// Ported from Sabari2005/linkedin-mcp-server, src/domains/profile.ts.
// Copyright (c) 2026 Sabari Vadivelan S. MIT License; see NOTICE.
//
// Profile writes go through LinkedIn's own forms, because that is what LinkedIn accepts for member
// edits. Every write returns before/after. Without `allowWrite` it is a dry run: nothing opens.

import type { Page } from "patchright";
import type { Li, WriteResult } from "./li.ts";
import { getProfile } from "./profile.ts";
import { SduiForm } from "./sdui-form.ts";
import type { Session } from "./session.ts";
import type { Voyager } from "./voyager.ts";

export interface ProfileWriteDeps {
  voyager: Voyager;
  queue: Session["queue"];
  newPage: () => Promise<Page>;
  allowWrite: boolean;
}

export type ProfileWrites = Pick<Li["profile"], "updateHeadline" | "updateAbout" | "updateLocation">;

const HEADLINE_LIMIT = 220;
const ABOUT_LIMIT = 2600;

const profileUrl = (publicId: string) => `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`;

export function createProfileWrites({ voyager, queue, newPage, allowWrite }: ProfileWriteDeps): ProfileWrites {
  /** Dry run unless writes are allowed; otherwise run `apply` on a fresh page, as one queued task. */
  async function write<T>(before: T, after: T, apply: (page: Page) => Promise<void>): Promise<WriteResult<T>> {
    if (!allowWrite) return { applied: false, before, after };
    await queue(async () => {
      const page = await newPage();
      try {
        await apply(page);
      } finally {
        await page.close();
      }
    });
    return { applied: true, before, after };
  }

  /** The "Edit intro" form holds the headline and location. */
  const openIntro = (page: Page, publicId: string) => SduiForm.open(page, `${profileUrl(publicId)}edit/intro/`);

  /**
   * The intro form requires an industry before any change saves, so a profile without one cannot
   * save a headline or location for reasons the caller cannot see.
   */
  async function saveIntro(form: SduiForm): Promise<void> {
    if (await form.isEmpty("Industry")) {
      throw new Error("lk: LinkedIn requires an industry before the intro saves; set one on LinkedIn first");
    }
    await form.save();
  }

  return {
    async updateHeadline(headline) {
      if (headline.length > HEADLINE_LIMIT) {
        throw new Error(`lk: headline is ${headline.length} characters; LinkedIn's limit is ${HEADLINE_LIMIT}`);
      }
      const me = await getProfile(voyager);
      return write(me.headline, headline, async (page) => {
        const form = await openIntro(page, me.publicId);
        // The headline is the intro form's only rich-text editor.
        await form.richText(headline);
        await saveIntro(form);
      });
    },

    async updateAbout(about) {
      if (about.length > ABOUT_LIMIT) {
        throw new Error(`lk: about is ${about.length} characters; LinkedIn's limit is ${ABOUT_LIMIT}`);
      }
      const me = await getProfile(voyager);
      return write(me.about, about, async (page) => {
        // LinkedIn calls this section "summary" internally; /edit/about/ 404s.
        const form = await SduiForm.open(page, `${profileUrl(me.publicId)}edit/forms/summary/new`);
        await form.richText(about);
        await form.save();
      });
    },

    async updateLocation(location) {
      const me = await getProfile(voyager);
      return write(me.location, location, async (page) => {
        const form = await openIntro(page, me.publicId);
        // "City" is the free-form field; Country/Region is a separate one.
        await form.typeahead("City", location);
        await saveIntro(form);
      });
    },
  };
}
