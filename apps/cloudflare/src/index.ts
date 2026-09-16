import { DurableObject } from 'cloudflare:workers';
import { launch } from '@cloudflare/playwright';
import { auditRequestSchema, terminalStatuses, type Audit, type AuditEvent } from '@blindspot/shared';
import { BrowserHost } from '../../server/src/browser.js';
import { runAuditJob, type WorkerResult } from '../../server/src/worker.js';
import { UnsafeUrlError } from '../../server/src/security.js';
import { z } from 'zod';
import { DurableArtifactStore } from './storage.js';
import { networkRoute, publicTarget } from './network.js';
import { boundedBytes, DEMO_LIMITS, json, SAMPLE_ID } from './limits.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const auditPath = new RegExp(`^/api/audits/(${uuid})(?:/(events|cancel)|/artifacts/(${uuid}))?$`);
const demoRequest = auditRequestSchema.refine(value => value.profileIds.length === 1, 'The free demo accepts one accessibility profile per audit.');
type DemoEnv = Env & { GEMINI_API_KEY?: string };

function failure(error: unknown): Response {
  if (error instanceof z.ZodError) return json({ error: error.issues.map(issue => issue.message).join('; ') }, 400);
  if (error instanceof UnsafeUrlError || error instanceof SyntaxError || error instanceof TypeError) return json({ error: 'Enter a valid public HTTP or HTTPS website URL and scenario.' }, 400);
  console.error(JSON.stringify({ event: 'demo_request_failed', kind: error instanceof Error ? error.name : 'unknown' }));
  return json({ error: 'The demo could not complete this request. The sample report is still available.' }, 503);
}

/** This object coordinates the single account-wide Browser Run allowance. */
export class DemoGate extends DurableObject<DemoEnv> {
  constructor(ctx: DurableObjectState, env: DemoEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, started INTEGER NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const now = Date.now();
      const recent = this.ctx.storage.sql.exec<{ started: number }>('SELECT started FROM reservations WHERE started > ? ORDER BY started', now - DEMO_LIMITS.retentionMs).toArray();
      const available = Math.max(0, DEMO_LIMITS.auditsPerDay - recent.length);
      const latest = recent.at(-1);
      const busyUntil = latest ? latest.started + DEMO_LIMITS.reservationMs : 0;
      const resetAt = recent[0] ? recent[0].started + DEMO_LIMITS.retentionMs : now;
      if (request.method === 'GET') return json({ geminiConfigured: Boolean(this.env.GEMINI_API_KEY), mode: 'cloudflare-free', demo: {
        maxProfiles: 1, maxActions: DEMO_LIMITS.maxActions, maxPageStates: DEMO_LIMITS.maxPageStates,
        maxSeconds: DEMO_LIMITS.timeoutMs / 1000, remaining: available, auditsPerDay: DEMO_LIMITS.auditsPerDay,
        busyUntil: busyUntil > now ? busyUntil : null, resetAt: available ? null : resetAt,
      } });
      if (!this.env.GEMINI_API_KEY) return json({ error: 'Live audits are not configured yet. Explore the sample report.' }, 503);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send a JSON audit request.' }, 415);
      let bytes: Uint8Array;
      try { bytes = await boundedBytes(request.body, 16_384); }
      catch { return json({ error: 'The audit request is too large.' }, 413); }
      const input = demoRequest.parse(JSON.parse(new TextDecoder().decode(bytes)));
      await publicTarget(input.url);
      // Recheck after network I/O; SQLite operations below execute atomically
      // without yielding, so concurrent submissions cannot reserve the same slot.
      const reservedAt = Date.now();
      this.ctx.storage.sql.exec('DELETE FROM reservations WHERE started <= ?', reservedAt - DEMO_LIMITS.retentionMs);
      const reservations = this.ctx.storage.sql.exec<{ started: number }>('SELECT started FROM reservations ORDER BY started').toArray();
      if (reservations.length >= DEMO_LIMITS.auditsPerDay) return json({ error: 'All four live audits for the last 24 hours have been used. Explore the sample report or try again later.' }, 429,
        { 'Retry-After': String(Math.max(1, Math.ceil(((reservations[0]?.started ?? reservedAt) + DEMO_LIMITS.retentionMs - reservedAt) / 1000))) });
      const previous = reservations.at(-1);
      if (previous && reservedAt - previous.started < DEMO_LIMITS.reservationMs) return json({ error: 'Another demo audit is running or cooling down. Please try again in a couple of minutes.' }, 429,
        { 'Retry-After': String(Math.ceil((previous.started + DEMO_LIMITS.reservationMs - reservedAt) / 1000)) });
      const id = crypto.randomUUID();
      this.ctx.storage.sql.exec('INSERT INTO reservations (id, started) VALUES (?, ?)', id, reservedAt);
      const timestamp = new Date(reservedAt).toISOString();
      const audit: Audit = { id, request: input, status: 'queued', createdAt: timestamp, updatedAt: timestamp, pageStates: [],
        progress: { phase: 'Queued', completedProfiles: 0, totalProfiles: 1 } };
      const initialized = await this.env.AUDIT_RUNNER.getByName(id).fetch('https://audit.internal/initialize', { method: 'POST', body: JSON.stringify(audit) });
      if (!initialized.ok) throw new Error('Audit initialization failed.');
      return json({ id }, 202);
    } catch (error) { return failure(error); }
  }
}

export class AuditRunner extends DurableObject<DemoEnv> {
  private readonly store: DurableArtifactStore;
  private controller?: AbortController;

  constructor(ctx: DurableObjectState, env: DemoEnv) {
    super(ctx, env);
    this.store = new DurableArtifactStore(ctx.storage);
  }

  private async initialize(audit: Audit): Promise<void> {
    if (await this.store.loadAudit(audit.id)) return;
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    await this.store.saveAudit(audit);
  }

  private async update(audit: Audit, result: WorkerResult): Promise<void> {
    Object.assign(audit, result, { updatedAt: new Date().toISOString() });
    audit.progress.phase = result.status === 'running' ? 'Inspecting the website' : result.status === 'completed' ? 'Report ready' : 'Review captured evidence';
    if (terminalStatuses.includes(result.status)) audit.progress.completedProfiles = audit.report?.profiles.length ?? 0;
    await this.store.saveAudit(audit);
  }

  async alarm(): Promise<void> {
    const audit = await this.store.loadAudit('');
    if (!audit) return;
    const expiresAt = Date.parse(audit.createdAt) + DEMO_LIMITS.retentionMs;
    if (Date.now() >= expiresAt) { await this.ctx.storage.deleteAll(); return; }
    await this.ctx.storage.setAlarm(expiresAt);
    if (terminalStatuses.includes(audit.status)) return;
    // Alarms may be delivered again after an isolate failure. Never repeat a
    // billed browser/Gemini attempt; retain its last saved evidence instead.
    if (audit.status === 'running' || Date.now() - Date.parse(audit.createdAt) > DEMO_LIMITS.reservationMs) {
      await this.update(audit, { status: audit.pageStates.length ? 'partial' : 'failed', pageStates: audit.pageStates,
        report: audit.report, error: 'The demo was interrupted. Saved evidence is preserved; this audit will not be retried automatically.' });
      return;
    }
    await this.update(audit, { status: 'running', pageStates: [] });
    const controller = new AbortController();
    this.controller = controller;
    if (await this.store.isCancelled(audit.id)) controller.abort();
    let browser: Awaited<ReturnType<typeof launch>> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const deadline = setTimeout(() => { controller.abort(); if (browser?.isConnected()) void browser.close().catch(() => undefined); }, DEMO_LIMITS.timeoutMs);
    const events: AuditEvent[] = [];
    const emit = (event: Omit<AuditEvent, 'id' | 'timestamp'>) => {
      events.push({ ...event, id: (events.at(-1)?.id ?? 0) + 1, timestamp: new Date().toISOString() });
      if (events.length > 150) events.shift();
    };
    try {
      const result = await runAuditJob({ id: audit.id, request: audit.request, geminiApiKey: this.env.GEMINI_API_KEY,
        geminiModel: this.env.GEMINI_MODEL, limits: { maxActions: DEMO_LIMITS.maxActions, maxPageStates: DEMO_LIMITS.maxPageStates,
          maxTurns: DEMO_LIMITS.maxTurns, timeoutMs: 20_000, viewportEvidence: true }, maxSpecialists: 1 }, {
        store: this.store, signal: controller.signal, emit,
        checkpoint: async result => { await this.store.saveEvents(audit.id, events); await this.update(audit, result); },
        launchHost: async options => {
          if (controller.signal.aborted) throw new Error('Audit cancelled before browser startup.');
          browser = await launch(this.env.BROWSER, { keep_alive: 10_000, guardrails: { allowedDomains: [] } });
          if (controller.signal.aborted) { await browser.close(); throw new Error('Audit cancelled before browser startup.'); }
          const cdp = await browser.newBrowserCDPSession();
          // Model requests can take longer than the idle timeout. Keep the
          // browser alive only while this bounded audit is still connected.
          heartbeat = setInterval(() => {
            if (browser?.isConnected() && !controller.signal.aborted) void cdp.send('Browser.getVersion').catch(() => undefined);
          }, 5000);
          return BrowserHost.remote(browser, options, networkRoute(controller.signal));
        },
      });
      const cancelled = await this.store.isCancelled(audit.id);
      if (controller.signal.aborted && !cancelled) {
        result.status = result.pageStates.length ? 'partial' : 'failed';
        result.error = 'The two-minute demo limit was reached. Captured evidence is preserved.';
      }
      result.report?.limitations.push('Free demo: one profile, at most four actions, two page states and three navigation model turns. Evidence screenshots cover the viewport. Live reports expire after 24 hours.',
        'Browser requests are anonymous and pass through the public Workers network. Cookies, media streams, non-default ports and state-changing requests are not supported.');
      await this.update(audit, result);
    } catch {
      await this.update(audit, { status: audit.pageStates.length ? 'partial' : 'failed', pageStates: audit.pageStates, report: audit.report,
        error: 'The browser service could not finish this audit. Its quota may be exhausted. The sample report is available.' });
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      if (browser?.isConnected()) await browser.close().catch(() => undefined);
      this.controller = undefined;
      await this.store.saveEvents(audit.id, events);
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/initialize' && request.method === 'POST') {
        const value = z.object({ id: z.string().uuid(), request: demoRequest, createdAt: z.string().datetime() }).parse(await request.json());
        await this.initialize({ ...value, updatedAt: value.createdAt, status: 'queued', pageStates: [], progress: { phase: 'Queued', completedProfiles: 0, totalProfiles: 1 } });
        return json({ id: value.id }, 201);
      }
      const match = url.pathname.match(auditPath);
      if (!match) return json({ error: 'Endpoint not found.' }, 404);
      const [, id, operation, artifactId] = match;
      const audit = await this.store.loadAudit(id);
      if (!audit || Date.now() >= Date.parse(audit.createdAt) + DEMO_LIMITS.retentionMs) return json({ error: 'Audit not found or expired. Live demo reports are kept for 24 hours.' }, 404);
      if (request.method === 'POST' && operation === 'cancel') {
        if (!terminalStatuses.includes(audit.status)) {
          await this.store.requestCancel(id);
          this.controller?.abort();
          if (audit.status === 'queued') await this.update(audit, { status: 'cancelled', pageStates: [] });
        }
        return json({ id, cancellationRequested: true });
      }
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      if (operation === 'events') {
        const after = Number(url.searchParams.get('after') ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) return json({ error: 'Invalid event cursor.' }, 400);
        return json({ events: (await this.store.loadEvents(id)).filter(event => event.id > after) });
      }
      if (operation) return json({ error: 'Method not allowed.' }, 405);
      if (artifactId) {
        const artifact = await this.store.get(id, artifactId);
        if (!artifact) return json({ error: 'Evidence not found.' }, 404);
        const isImage = ['image/png', 'image/jpeg'].includes(artifact.contentType);
        const headers = new Headers({ 'Content-Type': isImage ? artifact.contentType : 'text/plain; charset=utf-8',
          'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        if (!isImage) headers.set('Content-Disposition', `attachment; filename="${artifactId}.txt"`);
        return new Response(Uint8Array.from(artifact.content), { headers });
      }
      return json(audit);
    } catch (error) { return failure(error); }
  }
}

export default {
  async fetch(request: Request, env: DemoEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method === 'POST') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return json({ error: 'Cross-site requests are not accepted.' }, 403);
    }
    if (url.pathname === '/api/demo' && request.method === 'POST') return json({ id: SAMPLE_ID }, 201);
    const match = url.pathname.match(auditPath);
    if (match?.[1] === SAMPLE_ID && request.method === 'GET') {
      const suffix = match[3] ? `artifacts/${match[3]}` : match[2] === 'events' ? 'events.json' : 'audit.json';
      if (match[2] === 'cancel') return json({ error: 'Method not allowed.' }, 405);
      return env.ASSETS.fetch(new Request(new URL(`/sample/${suffix}`, request.url)));
    }
    if ((url.pathname === '/api/health' && request.method === 'GET') || (url.pathname === '/api/audits' && request.method === 'POST')) {
      return env.DEMO_GATE.getByName('browser-allowance').fetch(request);
    }
    if (match && (request.method === 'GET' || (request.method === 'POST' && match[2] === 'cancel'))) return env.AUDIT_RUNNER.getByName(match[1]).fetch(request);
    return json({ error: 'Endpoint not found.' }, 404);
  },
} satisfies ExportedHandler<DemoEnv>;
