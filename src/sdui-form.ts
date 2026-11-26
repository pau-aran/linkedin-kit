// Ported from Sabari2005/linkedin-mcp-server, src/browser/sdui-form.ts and src/domains/profile.ts.
// Copyright (c) 2026 Sabari Vadivelan S. MIT License; see NOTICE.
//
// Driver for LinkedIn's server-driven (SDUI) profile forms. Class names are hashed per build and
// input ids are React `useId` values, so fields are addressed the way a screen reader would: by
// their visible label. Modals are native `<dialog>` elements; long text is a contenteditable.

import type { Locator, Page } from "patchright";

/** Native <dialog>; the `open` attribute distinguishes it from ad overlays. */
const DIALOG = "dialog[open]";

/** Suggestion lists rendered by the typeahead components. */
const OPTION_SELECTORS = ['[role="option"]', '[data-testid="typeahead-result"]'];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** React's `useId` ids like `«r0»` must be escaped to appear in a selector. */
const cssEscape = (s: string): string => s.replace(/["\\]/g, "\\$&");

export class SduiForm {
  private constructor(
    readonly page: Page,
    readonly dialog: Locator,
  ) {}

  /** Navigate to a form URL and wait for its dialog. These routes render the dialog without a click. */
  static async open(page: Page, url: string): Promise<SduiForm> {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return SduiForm.attach(page, `edit dialog at ${url}`);
  }

  /** Wrap a dialog that is already open, e.g. after clicking a row's edit control. */
  static async attach(page: Page, what = "edit dialog"): Promise<SduiForm> {
    const dialog = page.locator(DIALOG).first();
    await dialog.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
      throw new Error(`lk: ${what} did not open`);
    });
    // The form hydrates after first paint; fields are not immediately fillable.
    await page.waitForTimeout(1_000);
    return new SduiForm(page, dialog);
  }

  /**
   * A control by its visible label; labels carry a trailing `*` when required, so matching is
   * non-exact. Hidden matches are excluded: conditional fields stay mounted but hidden.
   */
  field(label: string | RegExp): Locator {
    return this.dialog.getByLabel(label, { exact: false }).locator("visible=true");
  }

  /** Fill a plain <input> or <textarea> addressed by label. */
  async text(label: string, value: string): Promise<void> {
    const el = await this.required(label);
    await el.click().catch(() => {});
    await el.fill("");
    await typeSlowly(el, value);
  }

  /**
   * Fill a typeahead and pick a suggestion when one appears. Some typeaheads (Title, Degree) accept
   * free text; others (School, Company) only bind the entry when a suggestion is chosen.
   */
  async typeahead(label: string, value: string): Promise<void> {
    const el = await this.required(label);
    await el.click().catch(() => {});
    await el.fill("");
    await typeSlowly(el, value);
    // A dropped keystroke would make the typeahead store the wrong entity, so retype once.
    if ((await el.inputValue()).trim().toLowerCase() !== value.trim().toLowerCase()) {
      await el.fill("");
      await typeSlowly(el, value);
    }
    // Suggestions are fetched per keystroke; give the last request time to land.
    await this.page.waitForTimeout(1_200);

    const wanted = value.trim().toLowerCase();
    for (const selector of OPTION_SELECTORS) {
      const options = this.page.locator(selector).locator("visible=true");
      const texts = (await options.allTextContents()).map((t) => t.trim().toLowerCase());
      if (!texts.length) continue;
      const exact = texts.indexOf(wanted);
      const index = exact >= 0 ? exact : Math.max(0, texts.findIndex((t) => t.startsWith(wanted)));
      await options.nth(index).click({ timeout: 5_000 });
      return;
    }
    // No list appeared: the typed value stands. Escape dismisses any empty popover.
    await el.press("Escape").catch(() => {});
  }

  /** Replace the text of a rich-text editor: the one labelled `label`, or the dialog's only one. */
  async richText(value: string, label?: string): Promise<void> {
    const labelled = label && this.dialog.locator(`[role="textbox"][aria-label*="${cssEscape(label)}"]`).first();
    const el = labelled && (await labelled.count()) ? labelled : this.dialog.locator('[contenteditable="true"]').first();
    if (!(await el.count())) throw new Error(`lk: rich-text field ${label ?? ""} not found on the form`);
    await el.click();
    await el.press("ControlOrMeta+a");
    await el.press("Delete");
    // Enter inside ProseMirror starts a new block; Shift+Enter keeps one paragraph, as LinkedIn stores it.
    const lines = value.split("\n");
    for (const [i, line] of lines.entries()) {
      if (line) await typeSlowly(el, line);
      if (i < lines.length - 1) await el.press("Shift+Enter");
    }
  }

  /**
   * Set the checkbox in the row labelled `text`. The input is hidden behind a styled control, so a
   * click on it can move the DOM state without React seeing it; clicking its <label> is what a user does.
   */
  async checkbox(text: string, checked: boolean): Promise<boolean> {
    const row = this.field(new RegExp(escapeRegExp(text), "i")).first();
    if (!(await row.count())) return false;
    const isInput = (await row.evaluate((n) => n.tagName.toLowerCase())) === "input";
    const box = isInput ? row : row.locator('input[type="checkbox"]').first();
    if ((await box.isChecked()) === checked) return true;

    const id = await box.getAttribute("id");
    const attempts = [
      () => this.dialog.locator(`label[for="${cssEscape(id ?? "")}"]`).first().click({ timeout: 5_000 }),
      () => box.evaluate((node) => (node as HTMLElement).click()),
    ];
    for (const attempt of attempts) {
      await attempt().catch(() => {});
      if ((await box.isChecked()) === checked) {
        // Dependent fields (the end-date selects) mount on the next render.
        await this.page.waitForTimeout(500);
        return true;
      }
    }
    throw new Error(`lk: could not set the "${text}" checkbox`);
  }

  /**
   * Set start/end dates from "YYYY-MM" or "YYYY". Date selects sit in wrappers named like
   * "Start date month" or "End date (or expected) year"; forms without wrappers fall back to bare
   * "Month"/"Year" selects in DOM order, start then end. Setting one select can re-mount its
   * neighbours, so the group is re-applied until it settles.
   */
  async dates(range: { start?: string | undefined; end?: string | undefined }): Promise<void> {
    const wanted: { value: string; wrapper: RegExp; unit: "month" | "year"; slot: number }[] = [];
    for (const [slot, side, date] of [[0, "start", range.start], [1, "end", range.end]] as const) {
      if (!date) continue;
      const [year, month] = date.split("-");
      wanted.push({ value: year!, wrapper: new RegExp(`${side} date.*year`, "i"), unit: "year", slot });
      if (month) {
        wanted.push({ value: MONTHS[Number(month) - 1]!, wrapper: new RegExp(`${side} date.*month`, "i"), unit: "month", slot });
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      let stale = 0;
      for (const f of wanted) {
        const select = (await this.wrappedSelect(f.wrapper)) ?? (await this.bareDateSelect(f.unit, f.slot));
        if (!select || !(await selectOption(select, f.value))) stale++;
      }
      if (!stale) return;
    }
    throw new Error(`lk: could not set the dates ${JSON.stringify(range)}`);
  }

  /** Click Save and wait for the form to close or give way to a confirmation panel. */
  async save(): Promise<void> {
    const save = this.dialog.getByRole("button", { name: "Save", exact: true }).first();
    if (!(await save.count())) throw new Error("lk: the form has no Save button");
    await save.click();
    for (let i = 0; i < 30; i++) {
      await this.page.waitForTimeout(400);
      // LinkedIn often replaces the form with a confirmation panel that is still a <dialog>; it has no Save.
      if (!(await this.isOpen()) || !(await save.count())) {
        await this.dismiss();
        return;
      }
      const error = await this.inlineError();
      if (error) throw new Error(`lk: LinkedIn rejected the change: ${error}`);
    }
    const notice = await this.liveRegionNotice();
    throw new Error(
      notice
        ? `lk: the form did not close after saving; LinkedIn said: ${notice}`
        : "lk: the form did not close after saving; the change may not have applied",
    );
  }

  /**
   * Click the form's Delete button, then confirm in the stacked second dialog. Waiting for that
   * dialog specifically matters: clicking "the delete button" too early hits the form's own again.
   */
  async delete(): Promise<void> {
    const button = this.dialog.getByRole("button", { name: /^delete\b/i }).first();
    if (!(await button.count())) {
      await this.dismiss();
      throw new Error("lk: the form has no Delete button; LinkedIn may manage this entry");
    }
    await button.click();
    const confirm = this.page.locator(DIALOG).filter({ hasText: /cannot be undone|are you sure/i }).last();
    await confirm.waitFor({ state: "visible", timeout: 15_000 });
    await confirm.getByRole("button", { name: /^delete\b/i }).last().click();
    await this.page.waitForTimeout(2_500);
  }

  /** True when a labelled field is present and empty. */
  async isEmpty(label: string): Promise<boolean> {
    const el = this.field(label).first();
    return (await el.count()) > 0 && (await el.inputValue()).trim() === "";
  }

  /** Close without saving. */
  async dismiss(): Promise<void> {
    if (!(await this.isOpen())) return;
    await this.page.locator(DIALOG).getByRole("button", { name: /dismiss|close|cancel/i }).first().click({ timeout: 4_000 }).catch(() => {});
    if (await this.isOpen()) await this.page.keyboard.press("Escape");
    // A "discard changes?" prompt may be showing now.
    await this.page.getByRole("button", { name: /discard/i }).first().click({ timeout: 1_000 }).catch(() => {});
  }

  private async isOpen(): Promise<boolean> {
    return (await this.page.locator(DIALOG).count()) > 0;
  }

  private async required(label: string): Promise<Locator> {
    const el = this.field(label).first();
    if (!(await el.count())) throw new Error(`lk: field "${label}" not found on the form`);
    return el;
  }

  /** The native <select> behind a wrapper such as `<div aria-label="Start date month">`. */
  private async wrappedSelect(label: RegExp): Promise<Locator | undefined> {
    const base = this.field(label).first();
    if (!(await base.count())) return undefined;
    if ((await base.evaluate((n) => n.tagName.toLowerCase())) === "select") return base;
    const inner = base.locator("select").first();
    return (await inner.count()) ? inner : undefined;
  }

  /** The `slot`-th visible <select> whose placeholder option is "Month" or "Year". */
  private async bareDateSelect(unit: "month" | "year", slot: number): Promise<Locator | undefined> {
    const selects = this.dialog.locator("select").locator("visible=true");
    const placeholders = await selects.evaluateAll((nodes) =>
      nodes.map((n) => ((n as HTMLSelectElement).options[0]?.textContent ?? "").trim().toLowerCase()),
    );
    const index = placeholders.flatMap((p, i) => (p === unit ? [i] : []))[slot];
    return index === undefined ? undefined : selects.nth(index);
  }

  /** Whatever the dialog's validation paragraphs say. They have no role or stable class, only wording. */
  private async inlineError(): Promise<string | undefined> {
    const VALIDATION = /\bis (a )?required\b|\bmust be\b|\bcannot be\b|\bcan't be\b|\binvalid\b|\bplease (enter|select|provide|choose)\b|\btoo long\b/i;
    const NOISE = /^\*|^\d+\s*\/\s*\d+$|indicates required/i;
    const texts = await this.dialog.locator('[role="alert"], [data-testid*="error"], p, span').allTextContents();
    return texts.map((t) => t.trim()).find((t) => t && t.length < 200 && !NOISE.test(t) && VALIDATION.test(t));
  }

  /** Live-region announcements, e.g. "This skill is already on your profile". */
  private async liveRegionNotice(): Promise<string | undefined> {
    const NOISE = /^\*|^\d+\s*\/\s*\d+$|indicates required|^\d+ notifications?$/i;
    const texts = await this.dialog.locator('[role="alert"], [role="status"], [aria-live]').allTextContents();
    return texts.map((t) => t.replace(/\s+/g, " ").trim()).find((t) => t && t.length < 200 && !NOISE.test(t));
  }
}

/** Choose an option by visible text and read it back; a re-mount can silently discard the choice. */
async function selectOption(select: Locator, value: string): Promise<boolean> {
  const options = (await select.locator("option").allTextContents()).map((o) => o.trim());
  const match = options.find((o) => o.toLowerCase() === value.toLowerCase());
  if (!match) return false;
  // force: the native select is often wrapped by a styled component and reported as not visible.
  await select.selectOption({ label: match }, { force: true, timeout: 8_000 }).catch(() => {});
  const current = await select.evaluate((n) => ((n as HTMLSelectElement).selectedOptions[0]?.textContent ?? "").trim());
  return current === match;
}

/**
 * Type with real keystrokes: React inputs and typeaheads ignore `fill()`. These inputs attach their
 * handlers a beat after focus, and typing at once loses the first character.
 */
async function typeSlowly(el: Locator, value: string): Promise<void> {
  await el.page().waitForTimeout(250);
  await el.pressSequentially(value, { delay: 30 });
}
