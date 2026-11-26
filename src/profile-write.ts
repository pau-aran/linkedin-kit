// Ported from Sabari2005/linkedin-mcp-server, src/domains/profile.ts.
// Copyright (c) 2026 Sabari Vadivelan S. MIT License; see NOTICE.
//
// Profile writes go through LinkedIn's own forms, because that is what LinkedIn accepts for member
// edits. Every write returns before/after. Without `allowWrite` it is a dry run: nothing opens.

import type { Page } from "patchright";
import type { Education, Li, Position, WriteResult } from "./li.ts";
import { getProfile, readProfile, type ProfileEntries } from "./profile.ts";
import { SduiForm } from "./sdui-form.ts";
import type { Session } from "./session.ts";
import type { Voyager } from "./voyager.ts";

export interface ProfileWriteDeps {
  voyager: Voyager;
  queue: Session["queue"];
  newPage: () => Promise<Page>;
  allowWrite: boolean;
}

export type ProfileWrites = Omit<Li["profile"], "get" | "addSkill" | "removeSkill">;

const HEADLINE_LIMIT = 220;
const ABOUT_LIMIT = 2600;

const profileUrl = (publicId: string) => `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`;

/** How to reach and fill one profile section's add/edit form. */
interface Section<T> {
  /** The form route: /in/{id}/edit/forms/{slug}/new or /in/{id}/edit/forms/{slug}/{entryId}. */
  slug: string;
  name: string;
  entries(read: ProfileEntries): { list: T[]; ids: string[] };
  fill(form: SduiForm, values: Partial<T>, isNew: boolean): Promise<void>;
}

const POSITIONS: Section<Position> = {
  slug: "position",
  name: "experience",
  entries: (read) => ({ list: read.profile.experience, ids: read.positionIds }),
  async fill(form, p, isNew) {
    // These forms default to announcing the change to the whole network.
    await form.checkbox("Notify network", false);
    if (p.title !== undefined) await form.typeahead("Title", p.title);
    if (p.company !== undefined) await form.typeahead("Company or organization", p.company);
    // Not "Location type", which sits next to it.
    if (p.location !== undefined) await form.typeahead(/^Location(?! type)/i, p.location);
    if (p.description !== undefined) await form.richText(p.description, "Description");
    // The end-date selects only render once "currently working here" is unticked.
    if (isNew || p.end !== undefined) await form.checkbox("currently working in this role", p.end === undefined);
    await form.dates({ start: p.start, end: p.end });
  },
};

const EDUCATIONS: Section<Education> = {
  slug: "education",
  name: "education",
  entries: (read) => ({ list: read.profile.education, ids: read.educationIds }),
  async fill(form, e) {
    await form.checkbox("Notify network", false);
    if (e.school !== undefined) await form.typeahead("School", e.school);
    if (e.degree !== undefined) await form.typeahead("Degree", e.degree);
    if (e.field !== undefined) await form.typeahead("Field of study", e.field);
    if (e.description !== undefined) await form.text("Description", e.description);
    await form.dates({ start: e.start, end: e.end });
  },
};

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

  /** Add, edit and remove for one section. Entries are addressed by their index in `profile.get()`. */
  function sectionWrites<T extends object>(section: Section<T>) {
    async function entryAt(index: number) {
      const read = await readProfile(voyager);
      const { list, ids } = section.entries(read);
      const entry = list[index];
      if (!entry) throw new Error(`lk: no ${section.name} entry at index ${index}; the profile has ${list.length}`);
      const id = ids[index];
      if (!id) throw new Error(`lk: LinkedIn exposes no id for ${section.name} entry ${index}, so it cannot be edited`);
      return { entry, url: `${profileUrl(read.profile.publicId)}edit/forms/${section.slug}/${id}`, id };
    }

    return {
      async add(values: T): Promise<WriteResult<T | null>> {
        const me = await getProfile(voyager);
        return write<T | null>(null, values, async (page) => {
          const form = await SduiForm.open(page, `${profileUrl(me.publicId)}edit/forms/${section.slug}/new`);
          await section.fill(form, values, true);
          await form.save();
        });
      },

      async edit(index: number, patch: Partial<T>): Promise<WriteResult<T | null>> {
        const { entry, url } = await entryAt(index);
        return write<T | null>(entry, { ...entry, ...patch }, async (page) => {
          const form = await SduiForm.open(page, url);
          await section.fill(form, patch, false);
          await form.save();
        });
      },

      async remove(index: number): Promise<WriteResult<T | null>> {
        const { entry, url, id } = await entryAt(index);
        const result = await write<T | null>(entry, null, async (page) => (await SduiForm.open(page, url)).delete());
        // Deleting gives no usable success signal in the UI; the only honest check is that the entry is gone.
        if (result.applied && section.entries(await readProfile(voyager)).ids.includes(id)) {
          throw new Error(`lk: the ${section.name} entry at index ${index} is still on the profile; nothing was deleted`);
        }
        return result;
      },
    };
  }

  const positions = sectionWrites(POSITIONS);
  const educations = sectionWrites(EDUCATIONS);

  return {
    addPosition: positions.add,
    editPosition: positions.edit,
    removePosition: positions.remove,
    addEducation: educations.add,
    editEducation: educations.edit,
    removeEducation: educations.remove,

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
