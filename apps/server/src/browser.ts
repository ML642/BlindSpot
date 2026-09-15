import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type CDPSession, type JSHandle, type Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import type { AuditEvent, InteractionMode, PageState, SimulationArtifact } from '@blindspot/shared';
import { collectDomSignals, type DomSignals, type FocusStop, type Rendering } from '@blindspot/playbooks';
import type { ArtifactStore } from './storage.js';
import { assertSafeUrl, UnsafeUrlError } from './security.js';
import { startNetworkProxy } from './network-proxy.js';
import { ScreenReaderDriver } from './screen-reader.js';
import { inPage } from './page-script.js';

export interface BrowserLimits {
  maxActions: number;
  maxPageStates: number;
  timeoutMs: number;
}

export interface HostOptions {
  startUrl: string;
  fixtureTarget?: string;
  emit: (event: Omit<AuditEvent, 'id' | 'timestamp'>) => void;
}

export interface SessionOptions extends BrowserLimits {
  mode: InteractionMode;
  /** Alternative renderings captured with every page state (pointer journeys). */
  renderings?: Rendering[];
  store: ArtifactStore;
  auditId: string;
  signal: AbortSignal;
  emit: (event: Omit<AuditEvent, 'id' | 'timestamp'>) => void;
  onCapture?: (page: Page, snapshot: PageSnapshot, probePage?: Page) => Promise<void>;
}

/** Kept for tests and tooling that open a single session with its own browser. */
export type BrowserOptions = SessionOptions & { startUrl: string; fixtureTarget?: string };

export interface PageSnapshot {
  state: PageState;
  dom: string;
  accessibility: string;
  bodyText: string;
  controls: ControlSummary[];
  axe: AxeResult;
  signals?: DomSignals;
  /** Full screen-reader read-through (screen-reader journeys). */
  speech?: string[];
  /** Filled in by the worker from the interaction probes. */
  focusTrace?: FocusStop[];
}

export interface ControlSummary { tag: string; role?: string; name?: string; type?: string; selector?: string; text?: string; }
export interface AxeResult { violations: Array<{ id: string; tags?: string[]; impact?: string | null; help: string; description: string; helpUrl: string; nodes: Array<{ html: string; target: string[]; failureSummary?: string; any?: Array<{ id?: string; data?: unknown; message?: string }> }> }>; passes: number; incomplete: number; inapplicable: number; error?: string; passedRules?: Array<{ id: string; tags: string[]; help: string; nodes: [] }>; }

/** A visible interactive element as a sighted person would describe it: no ids or selectors. */
export interface TargetSummary { n: number; tag: string; role?: string; type?: string; label: string; box: { x: number; y: number; w: number; h: number }; visible: boolean; }
export interface FocusedSummary { description: string; tag: string; inViewport: boolean; inPasswordForm: boolean; }

export class AuditLimitError extends Error { constructor(message: string) { super(message); this.name = 'AuditLimitError'; } }
export class AuditCancelledError extends Error { constructor() { super('Audit cancelled'); this.name = 'AuditCancelledError'; } }

function ensureString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}

/** Height-capped JPEG of the top of the page: small enough for model review, tall enough to show reflow. */
async function previewShot(page: Page, width: number): Promise<Buffer> {
  const height = await page.evaluate(() => Math.min(Math.max(document.documentElement.scrollHeight, 400), 2400)).catch(() => 900);
  return page.screenshot({ type: 'jpeg', quality: 70, fullPage: true, clip: { x: 0, y: 0, width, height }, animations: 'disabled' });
}

async function waitForStable(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => undefined);
  await page.waitForTimeout(120);
}

type AriaRole = Parameters<Page['getByRole']>[0];

function sameDocument(a: string, b: string): boolean {
  try { const left = new URL(a); const right = new URL(b); left.hash = ''; right.hash = ''; return left.toString() === right.toString(); } catch { return a === b; }
}

/** Jaccard similarity of accessibility-tree lines; dynamic pages never replay byte-for-byte. */
function similarity(a: string, b: string): number {
  const left = new Set(a.split('\n').map(line => line.trim()).filter(Boolean));
  const right = new Set(b.split('\n').map(line => line.trim()).filter(Boolean));
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const line of left) if (right.has(line)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Roles and names spoken as "role, name, state, state" become a locator for replay. */
export function parseSpokenControl(phrase: string): { role: string; name: string } | undefined {
  const match = /^([a-z]+), ([^,]+)/i.exec(phrase);
  if (!match) return undefined;
  const name = match[2].trim();
  return name && !/^(end of|level \d)/i.test(name) ? { role: match[1].toLowerCase(), name } : undefined;
}

function controlLocator(page: Page, args: { selector?: string; text?: string; role?: string }) {
  if (args.selector) return page.locator(args.selector).first();
  if (args.role) return page.getByRole(args.role as AriaRole, args.text ? { name: args.text } : undefined).first();
  return page.getByText(args.text ?? '', { exact: false }).first();
}

/** Runs in every document before page scripts: blocks any submission of a form that contains a password field. */
const GUARD_SCRIPT = `(() => {
  if (window.__blindspotGuard) return;
  window.__blindspotGuard = { blocked: [] };
  const hasPassword = (form) => Boolean(form && form.querySelector && form.querySelector('input[type="password"]'));
  document.addEventListener('submit', (event) => {
    if (!hasPassword(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    window.__blindspotGuard.blocked.push('Login submission is blocked by the audit; only discovery and empty-field validation are allowed.');
  }, true);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button, input[type="submit"], input[type="image"]') : null;
    if (!target) return;
    const form = target.form || target.closest('form');
    const type = (target.getAttribute('type') || (target.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
    if (!hasPassword(form) || type === 'button' || type === 'reset') return;
    event.preventDefault(); event.stopImmediatePropagation();
    window.__blindspotGuard.blocked.push('Login submission is blocked by the audit; only discovery and empty-field validation are allowed.');
  }, true);
})();`;

const TARGET_QUERY = () => [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="option"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])')]
  .filter(el => { const rect = el.getBoundingClientRect(); const style = getComputedStyle(el); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && (el as HTMLInputElement).type !== 'hidden'; })
  .slice(0, 150);

const RENDERING_LABELS: Record<Rendering, string> = {
  blurredVision: 'Blurred vision', reducedContrast: 'Reduced contrast', protanopia: 'Protanopia', deuteranopia: 'Deuteranopia', tritanopia: 'Tritanopia', achromatopsia: 'Achromatopsia', 'narrow-viewport': '320px-wide viewport (400% zoom equivalent)', 'large-text': '200% text size',
};

/** One Chromium process and one egress proxy shared by every journey of an audit. */
export class BrowserHost {
  private constructor(readonly browser: Browser, readonly origin: string, private readonly proxy: { url: string; close: () => Promise<void> } | undefined, readonly options: HostOptions) {}

  static async launch(options: HostOptions): Promise<BrowserHost> {
    const target = await assertSafeUrl(options.startUrl, { fixtureTarget: options.fixtureTarget, allowFixture: true });
    const proxy = await startNetworkProxy({ fixtureTarget: options.fixtureTarget });
    const browser = await chromium.launch({
      headless: true,
      proxy: proxy ? { server: proxy.url } : undefined,
      args: proxy ? ['--proxy-bypass-list=<-loopback>', '--disable-quic'] : undefined,
    });

    return new BrowserHost(browser, target.origin, proxy, options);
  }

  get hasProxy(): boolean { return Boolean(this.proxy); }

  async openSession(options: SessionOptions): Promise<BrowserSession> {
    const context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      reducedMotion: 'no-preference',
      locale: 'en-US',
    });
    await context.addInitScript(GUARD_SCRIPT);
    const page = await context.newPage();
    // axe creates a trusted, opener-less page to aggregate frame results.
    // Only website-created popups belong to this event; context 'page' is broader.
    page.on('popup', (popup) => { options.emit({ type: 'warning', journey: options.mode, message: 'A popup was blocked during the audit.' }); void popup.close().catch(() => undefined); });
    page.on('download', (download) => { options.emit({ type: 'warning', journey: options.mode, message: `A download was blocked: ${download.suggestedFilename()}` }); void download.cancel(); });
    await context.routeWebSocket('**/*', socket => socket.close());
    const startOrigin = this.origin;
    const proxied = this.hasProxy;
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      let parsed: URL;
      try { parsed = new URL(requestUrl); } catch { await route.abort('blockedbyclient'); return; }
      if (!['http:', 'https:'].includes(parsed.protocol)) { await route.abort('blockedbyclient'); return; }
      if (route.request().resourceType() === 'websocket' || !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { await route.abort('blockedbyclient'); return; }
      // With the pinned proxy, DNS and private-address checks happen before the
      // socket is opened. Without it, retaining the original origin closes the
      // DNS rebinding window for the fallback path.
      if (!proxied && parsed.origin !== startOrigin) { await route.abort('blockedbyclient'); return; }
      await route.continue();
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) options.emit({ type: 'navigation', journey: options.mode, message: frame.url() });
    });
    const session = new BrowserSession(this, context, page, options);
    try {
      await session.navigate(this.options.startUrl);
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
    await this.proxy?.close().catch(() => undefined);
  }
}

/** One journey through the site in a fixed interaction mode. */
export class BrowserSession {
  readonly snapshots: PageSnapshot[] = [];
  readonly mode: InteractionMode;
  /** Present only for screen-reader journeys. */
  readonly screenReader?: ScreenReaderDriver;
  private actions = 0;
  private ownsHost = false;
  private cdp?: CDPSession;
  private history: Array<(page: Page) => Promise<unknown>> = [];
  private lastDialogCount = 0;
  private abortHandler = () => { void this.context.close().catch(() => undefined); };

  constructor(private readonly host: BrowserHost, readonly context: BrowserContext, readonly page: Page, private readonly options: SessionOptions) {
    this.mode = options.mode;
    if (options.mode === 'screen-reader') this.screenReader = new ScreenReaderDriver(page);
    options.signal.addEventListener('abort', this.abortHandler, { once: true });
  }

  /** Convenience for tests: a session with its own browser and proxy. */
  static async open(options: BrowserOptions): Promise<BrowserSession> {
    const host = await BrowserHost.launch({ startUrl: options.startUrl, fixtureTarget: options.fixtureTarget, emit: options.emit });
    try {
      const session = await host.openSession(options);
      session.ownsHost = true;
      return session;
    } catch (error) {
      await host.close();
      throw error;
    }
  }

  get browser(): Browser { return this.host.browser; }
  get actionCount(): number { return this.actions; }

  private emit(event: Omit<AuditEvent, 'id' | 'timestamp' | 'journey'>): void {
    this.options.emit({ ...event, journey: this.mode });
  }

  /** Counts a state-changing action against the limit. Reading and listing are free. */
  private check(): void {
    if (this.options.signal.aborted) throw new AuditCancelledError();
    this.actions += 1;
    if (this.actions > this.options.maxActions) throw new AuditLimitError(`The audit reached its ${this.options.maxActions}-action limit.`);
  }

  private async settle(): Promise<void> {
    if (this.options.signal.aborted) throw new AuditCancelledError();
    await waitForStable(this.page);
  }

  /** Messages recorded by the in-page guard since the last call. */
  async drainGuard(): Promise<string[]> {
    return this.page.evaluate(() => {
      const guard = (window as unknown as { __blindspotGuard?: { blocked: string[] } }).__blindspotGuard;
      if (!guard) return [] as string[];
      const messages = [...new Set(guard.blocked)];
      guard.blocked = [];
      return messages;
    }).catch(() => [] as string[]);
  }

  private async dialogCount(): Promise<number> {
    return this.page.evaluate(() => document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]').length).catch(() => 0);
  }

  /** Capture automatically when the document or its dialogs changed since the last capture. */
  async captureIfChanged(reason: string): Promise<PageSnapshot | undefined> {
    const last = this.snapshots.at(-1);
    const dialogs = await this.dialogCount();
    const urlChanged = !last || last.state.url !== this.page.url();
    const dialogChanged = dialogs !== this.lastDialogCount;
    if (!urlChanged && !dialogChanged) return undefined;
    if (this.snapshots.length >= this.options.maxPageStates) { this.lastDialogCount = dialogs; return undefined; }

    return this.capture(urlChanged ? `New page after ${reason}` : dialogs > this.lastDialogCount ? `Dialog opened after ${reason}` : `Dialog closed after ${reason}`);
  }

  async navigate(value: string): Promise<PageSnapshot> {
    this.check();
    const url = await assertSafeUrl(value, { fixtureTarget: this.host.options.fixtureTarget, allowFixture: true });
    if (!this.host.hasProxy && url.origin !== this.host.origin) throw new UnsafeUrlError('Cross-origin navigation is not allowed without the network proxy.');
    await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: this.options.timeoutMs });
    this.history.push(page => page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 }));
    await this.settle();

    return this.capture('Navigated to the requested page');
  }

  private async guardElement(element: JSHandle<Element> | import('playwright').ElementHandle<Element>): Promise<void> {
    const info = await element.evaluate((node) => ({ tag: node.tagName.toLowerCase(), type: node.getAttribute('type'), passwordForm: Boolean(node.closest('form')?.querySelector('input[type="password"]')) }));
    if (info.tag === 'input' && info.type === 'password') throw new Error('Password entry is blocked.');
    if (info.passwordForm && (info.type === 'submit' || (info.tag === 'button' && info.type !== 'button'))) throw new Error('Login submission is blocked; only discovery and empty-field validation are allowed.');
  }

  /** Selector-based click kept for tests and tooling; agents never receive selectors. */
  async click(args: { selector?: string; text?: string; role?: string }): Promise<PageSnapshot | undefined> {
    this.check();
    const selector = typeof args.selector === 'string' && args.selector.length <= 500 ? args.selector : undefined;
    const text = typeof args.text === 'string' && args.text.length <= 200 ? args.text : undefined;
    const role = typeof args.role === 'string' && args.role.length <= 80 ? args.role : undefined;
    if (!selector && !text && !role) throw new Error('click requires selector, text or role');
    const locator = controlLocator(this.page, { selector, text, role });
    const element = await locator.elementHandle({ timeout: 3_000 });
    if (!element) throw new Error('The requested control was not found.');
    await this.guardElement(element);
    await locator.click({ timeout: 3_000 });
    this.history.push(page => controlLocator(page, { selector, text, role }).click({ timeout: 3_000 }));
    await this.settle();

    return this.captureIfChanged(`activating ${text ?? selector ?? role}`);
  }

  /** Visible interactive elements for the sighted pointer journey. */
  async visibleTargets(): Promise<{ handle: JSHandle<Element[]>; items: TargetSummary[] }> {
    const handle = await this.page.evaluateHandle(TARGET_QUERY);
    const items = await handle.evaluate(els => els.map((el, index) => ({
      n: index + 1,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      type: el.getAttribute('type') || undefined,
      label: (el.getAttribute('aria-label') || ((el as HTMLInputElement).labels && (el as HTMLInputElement).labels?.[0]?.textContent) || el.textContent || el.getAttribute('placeholder') || el.getAttribute('title') || el.querySelector('img')?.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      box: ((rect) => ({ x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }))(el.getBoundingClientRect()),
      visible: ((rect) => rect.bottom > 0 && rect.top < innerHeight)(el.getBoundingClientRect()),
    })));

    return { handle, items };
  }

  private async targetElement(handle: JSHandle<Element[]>, index: number) {
    const element = (await handle.evaluateHandle((els, i) => els[i], index)).asElement();
    if (!element) throw new Error('The numbered element is no longer on the page. Look at the page again.');
    await this.guardElement(element);
    return element;
  }

  async clickTarget(handle: JSHandle<Element[]>, n: number): Promise<PageSnapshot | undefined> {
    this.check();
    const index = Math.floor(Number(n)) - 1;
    if (!Number.isInteger(index) || index < 0) throw new Error('Choose an element number from the list.');
    let element = await this.targetElement(handle, index);
    const label = await element.evaluate(node => (node.getAttribute('aria-label') || node.textContent || node.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 80)).catch(() => '');
    await element.scrollIntoViewIfNeeded().catch(() => undefined);
    try {
      await element.click({ timeout: 3_000 });
    } catch (error) {
      if (!/not attached|detached/i.test(error instanceof Error ? error.message : String(error))) throw error;
      // The page re-rendered after the list was built (autocomplete, hydration). Find the same control again.
      const fresh = await this.visibleTargets();
      const again = fresh.items.find(item => item.label === label && label) ?? fresh.items[index];
      if (!again) throw new Error('The element disappeared after the page re-rendered. Look at the page again.');
      element = await this.targetElement(fresh.handle, again.n - 1);
      await element.click({ timeout: 3_000 });
    }
    this.history.push(async page => { const els = await page.evaluateHandle(TARGET_QUERY); const el = (await els.evaluateHandle((list, i) => list[i], index)).asElement(); await el?.click({ timeout: 3_000 }); });
    await this.settle();

    return this.captureIfChanged(`clicking element ${n}`);
  }

  async typeIntoTarget(handle: JSHandle<Element[]>, n: number, text: string): Promise<void> {
    this.check();
    const index = Math.floor(Number(n)) - 1;
    if (!Number.isInteger(index) || index < 0) throw new Error('Choose an element number from the list.');
    if (typeof text !== 'string' || text.length > 500) throw new Error('Invalid text');
    const element = await this.targetElement(handle, index);
    const info = await element.evaluate((node) => ({ tag: node.tagName.toLowerCase(), type: (node.getAttribute('type') ?? '').toLowerCase(), name: `${node.getAttribute('name') ?? ''} ${node.getAttribute('autocomplete') ?? ''} ${node.id}`.toLowerCase(), editable: (node as HTMLElement).isContentEditable }));
    if (info.type === 'password' || /password|passcode|otp|one-time|token|cvv|cc-number/.test(info.name)) throw new Error('Credential entry is blocked.');
    if (!['input', 'textarea'].includes(info.tag) && !info.editable) throw new Error('Typing is allowed only in text fields.');
    await element.fill(text);
    this.history.push(async page => { const els = await page.evaluateHandle(TARGET_QUERY); const el = (await els.evaluateHandle((list, i) => list[i], index)).asElement(); await el?.fill(text); });
    await this.settle();
  }

  /** Selector-based typing kept for tests. */
  async type(args: { selector: string; text: string }): Promise<void> {
    this.check();
    const selector = ensureString(args.selector, 'selector', 500);
    if (typeof args.text !== 'string' || args.text.length > 500) throw new Error('Invalid text');
    const locator = this.page.locator(selector).first();
    const type = await locator.getAttribute('type').catch(() => null);
    const name = ((await locator.getAttribute('name').catch(() => null)) ?? '').toLowerCase();
    if (type === 'password' || /password|passcode|otp|one-time|token/.test(name)) throw new Error('Credential entry is blocked.');
    const tag = await locator.evaluate((node) => node.tagName.toLowerCase());
    if (!['input', 'textarea'].includes(tag) && (await locator.getAttribute('contenteditable')) !== 'true') throw new Error('Typing is allowed only in text fields.');
    await locator.fill(args.text);
    this.history.push(page => page.locator(selector).first().fill(args.text));
    await this.settle();
  }

  /** Type into whatever currently has keyboard focus (keyboard journey). */
  async typeIntoFocused(text: string): Promise<void> {
    this.check();
    if (typeof text !== 'string' || !text.length || text.length > 500) throw new Error('Invalid text');
    const focused = await this.focusedElement();
    if (focused.tag === 'body') throw new Error('Nothing has keyboard focus. Press Tab to reach a field first.');
    const info = await this.page.evaluate(() => { const node = document.activeElement as HTMLInputElement | null; return { tag: node?.tagName.toLowerCase() ?? '', type: (node?.getAttribute('type') ?? '').toLowerCase(), name: `${node?.getAttribute('name') ?? ''} ${node?.getAttribute('autocomplete') ?? ''} ${node?.id ?? ''}`.toLowerCase(), editable: Boolean(node?.isContentEditable) }; });
    if (info.type === 'password' || /password|passcode|otp|one-time|token|cvv|cc-number/.test(info.name)) throw new Error('Credential entry is blocked.');
    if (!['input', 'textarea'].includes(info.tag) && !info.editable) throw new Error('The focused element is not a text field.');
    await this.page.keyboard.type(text);
    this.history.push(page => page.keyboard.type(text));
    await this.settle();
  }

  async press(args: { key: string; count?: number; onEach?: () => Promise<void> }): Promise<PageSnapshot | undefined> {
    this.check();
    const key = ensureString(args.key, 'key', 40);
    const allowed = /^(Tab|Shift\+Tab|Enter|Escape|Arrow(Up|Down|Left|Right)|Home|End|Page(Up|Down)|Space)$/;
    if (!allowed.test(key)) throw new Error('Key is outside the safe action set.');
    const repeatable = /^(Tab|Shift\+Tab|Arrow(Up|Down|Left|Right))$/.test(key);
    const count = repeatable ? Math.max(1, Math.min(10, Math.floor(Number(args.count)) || 1)) : 1;
    for (let i = 0; i < count; i += 1) {
      await this.page.keyboard.press(key);
      this.history.push(page => page.keyboard.press(key));
      if (args.onEach) { await this.page.waitForTimeout(60); await args.onEach(); }
    }
    await this.settle();

    return this.captureIfChanged(`pressing ${key}${count > 1 ? ` ${count} times` : ''}`);
  }

  async scroll(args: { direction?: 'up' | 'down'; amount?: number }): Promise<void> {
    this.check();
    const amount = Math.max(100, Math.min(1000, Number(args.amount) || 600));
    await this.page.mouse.wheel(0, args.direction === 'up' ? -amount : amount);
    this.history.push(page => page.mouse.wheel(0, args.direction === 'up' ? -amount : amount));
    await this.page.waitForTimeout(150);
  }

  /** What a sighted keyboard user perceives about the focused element. */
  async focusedElement(): Promise<FocusedSummary> {
    return inPage(this.page, () => {
      const node = document.activeElement as HTMLElement | null;
      if (!node || node === document.body) return { description: 'Nothing is focused (document body).', tag: 'body', inViewport: true, inPasswordForm: false };
      const input = node as HTMLInputElement;
      const label = (node.getAttribute('aria-label') || (input.labels && input.labels[0]?.textContent) || (node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent : '') || node.textContent || node.getAttribute('placeholder') || node.getAttribute('title') || node.querySelector('img')?.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 100);
      const role = node.getAttribute('role') || ({ a: 'link', button: 'button', input: input.type === 'checkbox' || input.type === 'radio' || input.type === 'submit' ? input.type : 'text field', select: 'dropdown', textarea: 'text area', summary: 'disclosure' } as Record<string, string>)[node.tagName.toLowerCase()] || node.tagName.toLowerCase();
      const state = [input.disabled ? 'disabled' : '', input.required ? 'required' : '', input.checked ? 'checked' : '', node.getAttribute('aria-expanded') === 'true' ? 'expanded' : node.getAttribute('aria-expanded') === 'false' ? 'collapsed' : '', input.value && input.type !== 'password' ? `value "${String(input.value).slice(0, 40)}"` : ''].filter(Boolean).join(', ');
      const rect = node.getBoundingClientRect();
      return { description: `${role}${label ? ` "${label}"` : ' without visible label'}${state ? ` (${state})` : ''}`, tag: node.tagName.toLowerCase(), inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth, inPasswordForm: Boolean(node.closest('form')?.querySelector('input[type="password"]')) };
    });
  }

  async visibleText(limit = 4_000): Promise<string> {
    const text = await this.page.locator('body').innerText({ timeout: 3_000 }).catch(() => '');
    return text.replace(/\n{3,}/g, '\n\n').slice(0, limit);
  }

  /** A viewport screenshot compressed for the navigation agent. */
  async screenshotViewport(): Promise<Buffer> {
    return this.page.screenshot({ type: 'jpeg', quality: 60, fullPage: false, animations: 'disabled' }).catch(() => Buffer.alloc(0));
  }

  private async cdpSession(): Promise<CDPSession> {
    this.cdp ??= await this.context.newCDPSession(this.page);
    return this.cdp;
  }

  private async renderSimulations(prefix: string, title: string, probePage?: Page): Promise<SimulationArtifact[]> {
    const renderings = this.options.renderings ?? [];
    if (!renderings.length) return [];
    const out: SimulationArtifact[] = [];
    const vision = renderings.filter((item): item is Exclude<Rendering, 'narrow-viewport' | 'large-text'> => !['narrow-viewport', 'large-text'].includes(item));
    if (vision.length) {
      try {
        const cdp = await this.cdpSession();
        for (const type of vision) {
          await cdp.send('Emulation.setEmulatedVisionDeficiency', { type });
          await this.page.waitForTimeout(60);
          const shot = await this.page.screenshot({ type: 'jpeg', quality: 75, fullPage: false, animations: 'disabled' });
          const artifact = await this.options.store.put(this.options.auditId, `${prefix}.${type}.jpg`, shot, 'image/jpeg');
          out.push({ kind: type, artifactId: artifact.id, description: `${RENDERING_LABELS[type]} simulation of ${title}` });
        }
      } catch {
        this.emit({ type: 'warning', message: 'Vision-deficiency simulations could not be rendered for this state.' });
      } finally {
        await this.cdp?.send('Emulation.setEmulatedVisionDeficiency', { type: 'none' }).catch(() => undefined);
      }
    }
    if (probePage && renderings.includes('narrow-viewport')) {
      try {
        await probePage.setViewportSize({ width: 320, height: 900 });
        await probePage.waitForTimeout(200);
        const shot = await previewShot(probePage, 320);
        const artifact = await this.options.store.put(this.options.auditId, `${prefix}.narrow.jpg`, shot, 'image/jpeg');
        out.push({ kind: 'narrow-viewport', artifactId: artifact.id, description: `${RENDERING_LABELS['narrow-viewport']} rendering of ${title}` });
      } catch { /* the probe is best effort */ } finally { await probePage.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined); }
    }
    if (probePage && renderings.includes('large-text')) {
      try {
        await probePage.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        await probePage.waitForTimeout(150);
        const shot = await previewShot(probePage, 1440);
        const artifact = await this.options.store.put(this.options.auditId, `${prefix}.large-text.jpg`, shot, 'image/jpeg');
        out.push({ kind: 'large-text', artifactId: artifact.id, description: `${RENDERING_LABELS['large-text']} rendering of ${title}` });
      } catch { /* best effort */ } finally { await probePage.evaluate(() => { document.documentElement.style.fontSize = ''; }).catch(() => undefined); }
    }

    return out;
  }

  /** Record a meaningful page state. Everything is stored; perspectives decide who sees what. */
  async capture(description: string): Promise<PageSnapshot> {
    if (this.options.signal.aborted) throw new AuditCancelledError();
    if (this.snapshots.length >= this.options.maxPageStates) throw new AuditLimitError(`The audit reached its ${this.options.maxPageStates}-page-state limit.`);
    const url = this.page.url();
    const title = await this.page.title().catch(() => '');
    const bodyText = (await this.page.locator('body').innerText({ timeout: 3_000 }).catch(() => '')).slice(0, 20_000);
    const dom = await this.page.locator('html').evaluate((node) => node.outerHTML.slice(0, 250_000)).catch(() => '');
    const accessibility = await this.page.locator('body').ariaSnapshot().catch(async () => bodyText.slice(0, 20_000));
    const controls = await this.page.locator('button, a, input, textarea, select, [role]').evaluateAll((nodes) => nodes.slice(0, 400).map((node) => ({
      tag: node.tagName.toLowerCase(), role: node.getAttribute('role') ?? undefined,
      name: node.getAttribute('aria-label') ?? node.getAttribute('name') ?? undefined,
      type: node.getAttribute('type') ?? undefined,
      selector: node.id ? `#${node.id}` : undefined,
      text: (node.textContent ?? '').trim().slice(0, 160),
    }))).catch(() => [] as ControlSummary[]);
    const signals = await collectDomSignals(this.page).catch(() => undefined);
    let axeRaw: Awaited<ReturnType<AxeBuilder['analyze']>>;
    let axeError: string | undefined;
    try { axeRaw = await new AxeBuilder({ page: this.page }).analyze(); }
    catch { axeRaw = { violations: [], passes: [], incomplete: [], inapplicable: [] } as unknown as typeof axeRaw; axeError = 'axe could not inspect this state.'; this.emit({ type: 'warning', message: axeError }); }
    const axe: AxeResult = {
      violations: axeRaw.violations.map((item) => ({ id: item.id, tags: item.tags, impact: item.impact, help: item.help, description: item.description, helpUrl: item.helpUrl, nodes: item.nodes.map((node) => ({ html: node.html, target: node.target.map(String), failureSummary: node.failureSummary, any: node.any?.map(entry => ({ id: entry.id, data: entry.data, message: entry.message })) })) })),
      passes: axeRaw.passes.length, incomplete: axeRaw.incomplete.length, inapplicable: axeRaw.inapplicable.length, error: axeError,
      passedRules: axeRaw.passes.map(item => ({ id: item.id, tags: item.tags, help: item.help, nodes: [] })),
    };
    const screenshot = await this.page.screenshot({ type: 'png', fullPage: true, animations: 'disabled' }).catch(() => Buffer.alloc(0));
    const prefix = `${this.mode}-page-${this.snapshots.length + 1}`;
    const screenshotArtifact = screenshot.length ? await this.options.store.put(this.options.auditId, `${prefix}.png`, screenshot, 'image/png') : undefined;
    const preview = await previewShot(this.page, 1440).catch(() => Buffer.alloc(0));
    const previewArtifact = preview.length ? await this.options.store.put(this.options.auditId, `${prefix}.preview.jpg`, preview, 'image/jpeg') : undefined;
    const domArtifact = await this.options.store.put(this.options.auditId, `${prefix}.html`, dom, 'text/plain; charset=utf-8');
    const accessibilityArtifact = await this.options.store.put(this.options.auditId, `${prefix}.aria.txt`, accessibility, 'text/plain; charset=utf-8');
    let speech: string[] | undefined;
    let speechArtifactId: string | undefined;
    if (this.screenReader) {
      try {
        speech = await this.screenReader.readAll();
        speechArtifactId = (await this.options.store.put(this.options.auditId, `${prefix}.speech.txt`, speech.join('\n'), 'text/plain; charset=utf-8')).id;
      } catch { this.emit({ type: 'warning', message: 'The screen reader could not read this state top to bottom.' }); }
    }
    const state: PageState = { id: randomUUID(), url, title, capturedAt: new Date().toISOString(), journey: this.mode, screenshotArtifactId: screenshotArtifact?.id, previewArtifactId: previewArtifact?.id, domArtifactId: domArtifact.id, accessibilityArtifactId: accessibilityArtifact.id, speechArtifactId, description };
    const result: PageSnapshot = { state, dom, accessibility, bodyText, controls, axe, signals, speech };
    this.snapshots.push(result);
    this.lastDialogCount = await this.dialogCount();
    this.emit({ type: 'tool', message: `Captured page state: ${description}`, pageStateId: state.id });
    let probe: BrowserContext | undefined;
    let probePage: Page | undefined;
    try {
      probe = await this.host.browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'no-preference' });
      await probe.addInitScript(GUARD_SCRIPT);
      await probe.routeWebSocket('**/*', socket => socket.close());
      await probe.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
      const candidate = await probe.newPage();
      for (const action of this.history) { if (this.options.signal.aborted) throw new AuditCancelledError(); await action(candidate); await waitForStable(candidate); }
      const replayed = await candidate.locator('body').ariaSnapshot().catch(() => '');
      if (sameDocument(candidate.url(), result.state.url) && similarity(replayed, result.accessibility) >= 0.8) probePage = candidate;
      else this.emit({ type: 'warning', message: 'Replay differed from the captured state; interactive checks remain blocked.', pageStateId: state.id });
    } catch (error) {
      if (error instanceof AuditCancelledError) { await probe?.close().catch(() => undefined); throw error; }
      this.emit({ type: 'warning', message: 'Could not replay this state for isolated interaction checks.', pageStateId: state.id });
    }
    try {
      state.simulations = await this.renderSimulations(prefix, title || url, probePage);
      if (this.options.onCapture) await this.options.onCapture(this.page, result, probePage);
    } finally { await probe?.close().catch(() => undefined); }

    return result;
  }

  /** Record a replayable screen-reader activation so probes can rebuild the state. */
  recordScreenReaderAction(phrase: string, kind: 'activate' | 'type', text?: string): void {
    this.check();
    const control = parseSpokenControl(phrase);
    if (!control) return;
    const { role, name } = control;
    this.history.push(async page => {
      const locator = page.getByRole(role as AriaRole, { name, exact: false }).first();
      if (kind === 'activate') await locator.click({ timeout: 3_000 });
      else await locator.fill(text ?? '');
    });
  }

  async validateEmptyForm(args: { selector?: string }): Promise<{ valid: boolean; message: string; field?: string }> {
    this.check();
    const selector = typeof args.selector === 'string' && args.selector.length <= 500 ? args.selector : undefined;
    const form = selector ? this.page.locator(selector).first() : this.page.locator('form').first();
    if (!await form.count()) throw new Error('No form was found.');
    const result = await form.evaluate((node) => {
      const formNode = node as HTMLFormElement;
      const fields = Array.from(formNode.elements).filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => 'value' in element);
      const values = fields.map((field) => ({ name: field.getAttribute('name') ?? '', type: field.getAttribute('type') ?? '', value: field.value }));
      if (values.some((field) => !['hidden', 'submit', 'button'].includes(field.type) && field.value)) return { valid: false, message: 'The form is not empty; validation was skipped.' };
      const valid = formNode.checkValidity();
      formNode.reportValidity();
      const invalid = fields.find(field => !field.checkValidity());
      const label = invalid ? (invalid.getAttribute('aria-label') || (invalid.labels && invalid.labels[0]?.textContent) || invalid.getAttribute('placeholder') || invalid.getAttribute('name') || '').trim() : undefined;
      return { valid, message: valid ? 'The empty form is considered valid by the browser.' : `The browser reported required-field validation: "${invalid?.validationMessage ?? 'invalid'}"${label ? ` on the field "${label}"` : ''}.`, field: label || undefined };
    });
    this.emit({ type: 'tool', message: `Checked empty form${selector ? ` ${selector}` : ''}` });
    this.history.push(page => (selector ? page.locator(selector).first() : page.locator('form').first()).evaluate(node => (node as HTMLFormElement).reportValidity()));

    return result;
  }

  async close(): Promise<void> {
    this.options.signal.removeEventListener('abort', this.abortHandler);
    await this.context.close().catch(() => undefined);
    if (this.ownsHost) await this.host.close();
  }
}
