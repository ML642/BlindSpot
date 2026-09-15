import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import type { AuditEvent, PageState } from '@blindspot/shared';
import type { ArtifactStore } from './storage.js';
import { assertSafeUrl, UnsafeUrlError } from './security.js';
import { startNetworkProxy } from './network-proxy.js';

export interface BrowserLimits {
  maxActions: number;
  maxPageStates: number;
  timeoutMs: number;
}

export interface BrowserOptions extends BrowserLimits {
  startUrl: string;
  fixtureTarget?: string;
  store: ArtifactStore;
  auditId: string;
  signal: AbortSignal;
  emit: (event: Omit<AuditEvent, 'id' | 'timestamp'>) => void;
  onCapture?: (page: Page, snapshot: PageSnapshot, probePage?: Page) => Promise<void>;
}

export interface PageSnapshot {
  state: PageState;
  dom: string;
  accessibility: string;
  bodyText: string;
  controls: ControlSummary[];
  axe: AxeResult;
}

export interface ControlSummary { tag: string; role?: string; name?: string; type?: string; selector?: string; text?: string; }
export interface AxeResult { violations: Array<{ id: string; tags?: string[]; impact?: string | null; help: string; description: string; helpUrl: string; nodes: Array<{ html: string; target: string[]; failureSummary?: string }> }>; passes: number; incomplete: number; inapplicable: number; error?: string; passedRules?: Array<{id:string;tags:string[];help:string;nodes:[]}>; }

export class AuditLimitError extends Error { constructor(message: string) { super(message); this.name = 'AuditLimitError'; } }
export class AuditCancelledError extends Error { constructor() { super('Audit cancelled'); this.name = 'AuditCancelledError'; } }

function ensureString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}

async function waitForStable(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => undefined);
  await page.waitForTimeout(120);
}

type AriaRole = Parameters<Page['getByRole']>[0];

function controlLocator(page: Page, args: { selector?: string; text?: string; role?: string }) {
  if (args.selector) return page.locator(args.selector).first();
  if (args.role) return page.getByRole(args.role as AriaRole, args.text ? { name: args.text } : undefined).first();
  return page.getByText(args.text ?? '', { exact: false }).first();
}

export class BrowserSession {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly snapshots: PageSnapshot[] = [];
  private actions = 0;
  private readonly options: BrowserOptions;
  private readonly origin: string;
  private proxy?: { url: string; close: () => Promise<void> };
  private history: Array<(page: Page) => Promise<unknown>> = [];
  private abortHandler = () => { void this.context.close().catch(() => undefined); };

  private constructor(browser: Browser, context: BrowserContext, page: Page, options: BrowserOptions, origin: string, proxy?: { url: string; close: () => Promise<void> }) {
    this.browser = browser; this.context = context; this.page = page; this.options = options; this.origin = origin; this.proxy = proxy;
    options.signal.addEventListener('abort', this.abortHandler, { once: true });
  }

  static async open(options: BrowserOptions): Promise<BrowserSession> {
    const target = await assertSafeUrl(options.startUrl, { fixtureTarget: options.fixtureTarget, allowFixture: true });
    const startOrigin = target.origin;
    const proxy = await startNetworkProxy({ fixtureTarget: options.fixtureTarget });
    const browser = await chromium.launch({
      headless: true,
      proxy: proxy ? { server: proxy.url } : undefined,
      args: proxy ? ['--proxy-bypass-list=<-loopback>', '--disable-quic'] : undefined,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      reducedMotion: 'no-preference',
      locale: 'en-US',
    });
    const page = await context.newPage();
    context.on('page', (popup) => { if (popup !== page) { options.emit({ type: 'warning', message: 'A popup was blocked during the audit.' }); void popup.close(); } });
    page.on('download', (download) => { options.emit({ type: 'warning', message: `A download was blocked: ${download.suggestedFilename()}` }); void download.cancel(); });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      let parsed: URL;
      try { parsed = new URL(requestUrl); } catch { await route.abort('blockedbyclient'); return; }
      if (!['http:', 'https:'].includes(parsed.protocol)) { await route.abort('blockedbyclient'); return; }
      if (route.request().resourceType() === 'websocket' || !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { await route.abort('blockedbyclient'); return; }
      // With the pinned proxy, DNS and private-address checks happen before the
      // socket is opened. Without it, retaining the original origin closes the
      // DNS rebinding window for the fallback path.
      if (!proxy && parsed.origin !== startOrigin) { await route.abort('blockedbyclient'); return; }
      await route.continue();
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) options.emit({ type: 'navigation', message: frame.url() });
    });
    const session = new BrowserSession(browser, context, page, options, startOrigin, proxy);
    try {
      await session.navigate(options.startUrl);
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  private check(): void {
    if (this.options.signal.aborted) throw new AuditCancelledError();
    this.actions += 1;
    if (this.actions > this.options.maxActions) throw new AuditLimitError(`The audit reached its ${this.options.maxActions}-action limit.`);
  }

  private async settle(): Promise<void> {
    if (this.options.signal.aborted) throw new AuditCancelledError();
    await waitForStable(this.page);
  }

  async navigate(value: string): Promise<PageSnapshot> {
    this.check();
    const url = await assertSafeUrl(value, { fixtureTarget: this.options.fixtureTarget, allowFixture: true });
    if (!this.proxy && url.origin !== this.origin) throw new UnsafeUrlError('Cross-origin navigation is not allowed without the network proxy.');
    await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: this.options.timeoutMs });
    this.history.push(page => page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 }));
    await this.settle();
    return this.capture('Navigated to the requested page');
  }

  async click(args: { selector?: string; text?: string; role?: string }): Promise<PageSnapshot> {
    this.check();
    const selector = typeof args.selector === 'string' && args.selector.length <= 500 ? args.selector : undefined;
    const text = typeof args.text === 'string' && args.text.length <= 200 ? args.text : undefined;
    const role = typeof args.role === 'string' && args.role.length <= 80 ? args.role : undefined;
    if (!selector && !text && !role) throw new Error('click requires selector, text or role');
    const locator = controlLocator(this.page, { selector, text, role });
    const element = await locator.elementHandle({ timeout: 3_000 });
    if (!element) throw new Error('The requested control was not found.');
    const type = await element.getAttribute('type');
    const tag = await element.evaluate((node) => node.tagName.toLowerCase());
    if (tag === 'input' && type === 'password') throw new Error('Password entry is blocked.');
    const formHasPassword = await element.evaluate((node) => Boolean((node as HTMLElement).closest('form')?.querySelector('input[type="password"]')));
    if (formHasPassword && (type === 'submit' || tag === 'button')) throw new Error('Login submission is blocked; only discovery and empty-field validation are allowed.');
    await locator.click({ timeout: 3_000 });
    this.history.push(page => controlLocator(page, { selector, text, role }).click({ timeout: 3_000 }));
    await this.settle();
    return this.capture(`Activated ${text ?? selector ?? role ?? 'control'}`);
  }

  async type(args: { selector: string; text: string }): Promise<PageSnapshot> {
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
    return this.capture(`Entered text in ${selector}`);
  }

  async press(args: { key: string }): Promise<PageSnapshot> {
    this.check();
    const key = ensureString(args.key, 'key', 40);
    const allowed = /^(Tab|Shift\+Tab|Enter|Escape|Arrow(Up|Down|Left|Right)|Home|End|Page(Up|Down)|Space)$/;
    if (!allowed.test(key)) throw new Error('Key is outside the safe action set.');
    if (key === 'Enter' || key === 'Space') {
      const unsafe = await this.page.evaluate(() => Boolean(document.activeElement?.closest('form')));
      if (unsafe) throw new Error('Form activation is blocked; use validate_empty_form.');
    }
    await this.page.keyboard.press(key);
    this.history.push(page => page.keyboard.press(key));
    await this.settle();
    return this.capture(`Pressed ${key}`);
  }

  async scroll(args: { direction?: 'up' | 'down'; amount?: number }): Promise<PageSnapshot> {
    this.check();
    const amount = Math.max(100, Math.min(1000, Number(args.amount) || 600));
    await this.page.mouse.wheel(0, args.direction === 'up' ? -amount : amount);
    this.history.push(page => page.mouse.wheel(0, args.direction === 'up' ? -amount : amount));
    await this.page.waitForTimeout(150);
    return this.capture(`Scrolled ${args.direction === 'up' ? 'up' : 'down'}`);
  }

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
    let axeRaw: Awaited<ReturnType<AxeBuilder['analyze']>>;
    let axeError: string | undefined;
    try { axeRaw = await new AxeBuilder({ page: this.page }).analyze(); }
    catch { axeRaw = { violations: [], passes: [], incomplete: [], inapplicable: [] } as unknown as typeof axeRaw; axeError = 'axe could not inspect this state.'; this.options.emit({ type: 'warning', message: axeError }); }
    const axe: AxeResult = {
      violations: axeRaw.violations.map((item) => ({ id: item.id, tags: item.tags, impact: item.impact, help: item.help, description: item.description, helpUrl: item.helpUrl, nodes: item.nodes.map((node) => ({ html: node.html, target: node.target.map(String), failureSummary: node.failureSummary })) })),
      passes: axeRaw.passes.length, incomplete: axeRaw.incomplete.length, inapplicable: axeRaw.inapplicable.length, error: axeError,
      passedRules: axeRaw.passes.map(item => ({ id: item.id, tags: item.tags, help: item.help, nodes: [] })),
    };
    const screenshot = await this.page.screenshot({ type: 'png', fullPage: true, animations: 'disabled' }).catch(() => Buffer.alloc(0));
    const prefix = `page-${this.snapshots.length + 1}`;
    const screenshotArtifact = screenshot.length ? await this.options.store.put(this.options.auditId, `${prefix}.png`, screenshot, 'image/png') : undefined;
    const domArtifact = await this.options.store.put(this.options.auditId, `${prefix}.html`, dom, 'text/plain; charset=utf-8');
    const accessibilityArtifact = await this.options.store.put(this.options.auditId, `${prefix}.aria.txt`, accessibility, 'text/plain; charset=utf-8');
    const state: PageState = { id: randomUUID(), url, title, capturedAt: new Date().toISOString(), screenshotArtifactId: screenshotArtifact?.id, domArtifactId: domArtifact.id, accessibilityArtifactId: accessibilityArtifact.id, description };
    const result = { state, dom, accessibility, bodyText, controls, axe };
    this.snapshots.push(result);
    this.options.emit({ type: 'tool', message: `Captured page state: ${description}`, pageStateId: state.id });
    if (this.options.onCapture) {
      let probe: BrowserContext | undefined;
      let probePage: Page | undefined;
      try {
        probe = await this.browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'no-preference' });
        await probe.routeWebSocket('**/*', socket => socket.close());
        await probe.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
        const candidate = await probe.newPage();
        for (const action of this.history) { if (this.options.signal.aborted) throw new AuditCancelledError(); await action(candidate); await waitForStable(candidate); }
        if (candidate.url() === result.state.url && await candidate.locator('body').ariaSnapshot() === result.accessibility) probePage = candidate;
        else this.options.emit({ type: 'warning', message: 'Replay differed from the captured state; interactive checks remain blocked.', pageStateId: state.id });
      } catch { this.options.emit({ type: 'warning', message: 'Could not replay this state for isolated interaction checks.', pageStateId: state.id }); }
      try { await this.options.onCapture(this.page, result, probePage); } finally { await probe?.close().catch(() => undefined); }
    }
    return result;
  }

  async validateEmptyForm(args: { selector?: string }): Promise<PageSnapshot> {
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
      return { valid, message: valid ? 'The empty form is considered valid by the browser.' : 'The browser reported required-field validation errors.' };
    });
    this.options.emit({ type: 'tool', message: `Checked empty form${selector ? ` ${selector}` : ''}` });
    this.history.push(page => (selector ? page.locator(selector).first() : page.locator('form').first()).evaluate(node => (node as HTMLFormElement).reportValidity()));
    return this.capture(`Empty-form validation: ${result.message}`);
  }

  async close(): Promise<void> {
    this.options.signal.removeEventListener('abort', this.abortHandler);
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
    await this.proxy?.close().catch(() => undefined);
  }

  get actionCount(): number { return this.actions; }
}
