import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { inPage } from './page-script.js';

let bundlePromise: Promise<{ body: string; exports: string }> | undefined;

/** Load the browser build of the virtual screen reader and rewrite its ESM export into a global. */
async function loadBundle(): Promise<{ body: string; exports: string }> {
  bundlePromise ??= (async () => {
    const require = createRequire(import.meta.url);
    const file = require.resolve('@guidepup/virtual-screen-reader/browser.js');
    const source = await readFile(file, 'utf8');
    const match = source.match(/export\s*\{([^}]*)\};?/);
    if (!match) throw new Error('Unexpected virtual screen reader bundle format.');
    const body = source.replace(match[0], '').replace(/\/\/# sourceMappingURL.*$/m, '');
    const exports = match[1].split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
      const [local, exported] = entry.split(/\s+as\s+/);
      return `${exported ?? local}: ${local}`;
    }).join(', ');
    return { body, exports };
  })();
  return bundlePromise;
}

export type ScreenReaderJump =
  | 'next_heading' | 'previous_heading' | 'next_landmark' | 'previous_landmark' | 'next_link' | 'previous_link'
  | 'next_button' | 'next_form_field' | 'next_main' | 'next_navigation' | 'next_form' | 'top' | 'bottom';

export type ElementListKind = 'headings' | 'landmarks' | 'links' | 'buttons' | 'form-fields';

export interface Announcement {
  /** Everything the screen reader spoke since the previous command, in order. */
  spoken: string[];
  /** The phrase for the item now under the virtual cursor. */
  current: string;
  pageTitle: string;
  url: string;
  /** True when a new document was loaded and reading restarted at the top. */
  newDocument: boolean;
}

interface VirtualApi {
  virtual: {
    start(options: { container: Node }): Promise<void>;
    stop(): Promise<void>;
    next(): Promise<void>;
    previous(): Promise<void>;
    act(): Promise<void>;
    interact(): Promise<void>;
    stopInteracting(): Promise<void>;
    type(text: string): Promise<void>;
    perform(command: unknown): Promise<void>;
    lastSpokenPhrase(): Promise<string>;
    spokenPhraseLog(): Promise<string[]>;
    commands: Record<string, unknown>;
  };
  Virtual: new () => VirtualApi['virtual'];
  started?: boolean;
}

const FORM_FIELD = /^(textbox|searchbox|combobox|listbox|checkbox|radio|switch|slider|spinbutton|button|link)\b/;
const END = /^end of document$/i;

/**
 * Drives a virtual screen reader inside the audited page. The audited document is
 * untrusted, so every phrase returned here is data for the model, never an instruction.
 */
export class ScreenReaderDriver {
  private readonly globalName = `__blindspotScreenReader${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  private consumed = 0;

  constructor(private readonly page: Page) {}

  /** Inject and start the screen reader for the current document if needed. */
  async ensure(): Promise<boolean> {
    const started = await this.page.evaluate((name) => {
      const api = (window as unknown as Record<string, VirtualApi | undefined>)[name];
      return Boolean(api && api.started);
    }, this.globalName).catch(() => false);
    if (started) return false;
    const bundle = await loadBundle();
    await this.page.evaluate(`(() => {\n${bundle.body}\nwindow[${JSON.stringify(this.globalName)}] = { ${bundle.exports} };\n})();`);
    await this.page.evaluate(async (name) => {
      const api = (window as unknown as Record<string, VirtualApi>)[name];
      await api.virtual.start({ container: document.body });
      api.started = true;
    }, this.globalName);
    this.consumed = 0;

    return true;
  }

  private async api<T>(fn: (api: VirtualApi, arg: unknown) => Promise<T> | T, arg?: unknown): Promise<T> {
    return inPage(this.page, (input: { name: string; arg: unknown; source: string }) => {
      const api = (window as unknown as Record<string, VirtualApi>)[input.name];
      const run = eval(`(${input.source})`) as (api: VirtualApi, arg: unknown) => Promise<T> | T;
      return run(api, input.arg);
    }, { name: this.globalName, arg: arg ?? null, source: fn.toString() });
  }

  private async drain(newDocument: boolean): Promise<Announcement> {
    const log = await this.api(api => api.virtual.spokenPhraseLog());
    const spoken = log.slice(this.consumed).map(phrase => String(phrase).slice(0, 400));
    this.consumed = log.length;
    const current = String((await this.api(api => api.virtual.lastSpokenPhrase())) ?? '').slice(0, 400);
    const pageTitle = await this.page.title().catch(() => '');
    if (newDocument) spoken.unshift(`New page loaded: ${pageTitle || this.page.url()}`);

    return { spoken, current, pageTitle, url: this.page.url(), newDocument };
  }

  /** Run a command and report what was spoken; re-injects after navigation. */
  private async command(run: (api: VirtualApi, arg: unknown) => Promise<void>, arg?: unknown): Promise<Announcement> {
    const fresh = await this.ensure();
    let navigated = false;
    try {
      await this.api(run, arg);
    } catch (error) {
      if (!/context was destroyed|navigation|Target closed|detached/i.test(error instanceof Error ? error.message : String(error))) throw error;
      navigated = true;
    }
    await this.page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => undefined);
    await this.page.waitForTimeout(150);
    const reinjected = await this.ensure();

    return this.drain(fresh || navigated || reinjected);
  }

  async readNext(count = 1): Promise<Announcement> {
    return this.command(async (api, arg) => {
      const steps = Math.max(1, Math.min(10, Number(arg) || 1));
      for (let i = 0; i < steps; i += 1) {
        await api.virtual.next();
        if (/^end of document$/i.test(await api.virtual.lastSpokenPhrase())) break;
      }
    }, count);
  }

  async readPrevious(count = 1): Promise<Announcement> {
    return this.command(async (api, arg) => {
      const steps = Math.max(1, Math.min(10, Number(arg) || 1));
      for (let i = 0; i < steps; i += 1) await api.virtual.previous();
    }, count);
  }

  async jump(target: ScreenReaderJump): Promise<Announcement> {
    return this.command(async (api, arg) => {
      const commands = api.virtual.commands;
      const named: Record<string, string> = { next_heading: 'moveToNextHeading', previous_heading: 'moveToPreviousHeading', next_landmark: 'moveToNextLandmark', previous_landmark: 'moveToPreviousLandmark', next_link: 'moveToNextLink', previous_link: 'moveToPreviousLink', next_main: 'moveToNextMain', next_navigation: 'moveToNextNavigation', next_form: 'moveToNextForm' };
      const key = String(arg);
      if (named[key]) { await api.virtual.perform(commands[named[key]]); return; }
      if (key === 'top') { await api.virtual.stop(); await api.virtual.start({ container: document.body }); return; }
      if (key === 'bottom') { for (let i = 0; i < 600; i += 1) { await api.virtual.next(); if (/^end of document$/i.test(await api.virtual.lastSpokenPhrase())) break; } return; }
      const pattern = key === 'next_button' ? /^button\b/ : /^(textbox|searchbox|combobox|listbox|checkbox|radio|switch|slider|spinbutton)\b/;
      for (let i = 0; i < 600; i += 1) {
        await api.virtual.next();
        const phrase = await api.virtual.lastSpokenPhrase();
        if (pattern.test(phrase) || /^end of document$/i.test(phrase)) break;
      }
    }, target);
  }

  /** Sweep the document with a second reader instance so the user's cursor does not move. */
  private async sweep(): Promise<string[]> {
    await this.ensure();
    return this.api(async (api) => {
      const reader = new api.Virtual();
      await reader.start({ container: document.body });
      const phrases: string[] = [];
      for (let i = 0; i < 500; i += 1) {
        await reader.next();
        const phrase = await reader.lastSpokenPhrase();
        phrases.push(phrase);
        if (/^end of document$/i.test(phrase)) break;
      }
      await reader.stop();
      return phrases;
    });
  }

  /** The equivalent of a screen reader's elements list. */
  async list(kind: ElementListKind): Promise<string[]> {
    const phrases = await this.sweep();
    const pattern = kind === 'headings' ? /^heading\b/ : kind === 'landmarks' ? /^(banner|navigation|main|contentinfo|complementary|search|region|form)\b/ : kind === 'links' ? /^link\b/ : kind === 'buttons' ? /^button\b/ : FORM_FIELD;
    const matches = phrases.filter(phrase => pattern.test(phrase) && !/^end of /i.test(phrase));

    return matches.slice(0, 80);
  }

  /** Everything the reader would speak reading the page top to bottom. */
  async readAll(): Promise<string[]> {
    const phrases = await this.sweep();

    return phrases.filter(phrase => !END.test(phrase) || phrases.length <= 1);
  }

  async activate(): Promise<Announcement> {
    return this.command(async (api) => { await api.virtual.act(); });
  }

  /** Type into the field under the cursor. Credentials are refused before any key is sent. */
  async type(text: string): Promise<Announcement> {
    return this.command(async (api, arg) => {
      await api.virtual.interact();
      const active = document.activeElement as HTMLInputElement | null;
      const type = (active?.getAttribute('type') ?? '').toLowerCase();
      const name = `${active?.getAttribute('name') ?? ''} ${active?.getAttribute('autocomplete') ?? ''} ${active?.id ?? ''}`.toLowerCase();
      if (type === 'password' || /password|passcode|otp|one-time|token|cvv|card-number|cc-number/.test(name)) {
        await api.virtual.stopInteracting();
        throw new Error('Credential entry is blocked.');
      }
      const editable = active && (['input', 'textarea'].includes(active.tagName.toLowerCase()) || active.isContentEditable);
      if (!editable) { await api.virtual.stopInteracting(); throw new Error('The item under the cursor is not a text field.'); }
      await api.virtual.type(String(arg));
      await api.virtual.stopInteracting();
    }, text);
  }

  /** A real key press; the reader follows the resulting focus change. */
  async afterKey(): Promise<Announcement> {
    return this.command(async () => undefined);
  }

  async whereAmI(): Promise<Announcement> {
    return this.command(async () => undefined);
  }
}
