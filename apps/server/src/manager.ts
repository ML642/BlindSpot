import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Audit, AuditEvent } from '@blindspot/shared';
import { auditRequestSchema, terminalStatuses } from '@blindspot/shared';
import type { ArtifactStore } from './storage.js';
import type { ServerConfig } from './config.js';
import { projectRoot } from './config.js';
import { assertSafeUrl, isFixtureUrl } from './security.js';
import { CloudRunJobAdapter } from './gcp-job.js';
import { createSampleAudit } from './sample.js';

export class AuditManager {
  private children = new Map<string, ChildProcess>();
  private admission: Promise<unknown> = Promise.resolve();
  constructor(private readonly config: ServerConfig, private readonly store: ArtifactStore) {}
  async init() {
    if (this.config.executionMode === 'local') for (const audit of await this.store.loadAudits()) {
      if (!terminalStatuses.includes(audit.status)) {
        audit.status = audit.pageStates.length ? 'partial' : 'failed';
        audit.error = 'The API restarted before this audit finished. Captured evidence is preserved.';
        audit.updatedAt = new Date().toISOString(); await this.store.saveAudit(audit);
      }
    }
  }
  create(input: unknown): Promise<Audit> {
    const result = this.admission.then(async () => {
      const request = auditRequestSchema.parse(input);
      await assertSafeUrl(request.url, { allowFixture: this.config.executionMode === 'local', fixtureTarget: this.config.fixtureTarget });
      if (!this.config.geminiApiKey && !isFixtureUrl(request.url, this.config.fixtureTarget)) {
        throw Object.assign(new Error('Configure GEMINI_API_KEY on the server to run a live audit. The sample report is available without a key.'), { statusCode: 503 });
      }
      const active = (await this.store.loadAudits()).filter(a => !terminalStatuses.includes(a.status) && Date.now() - Date.parse(a.createdAt) < (this.config.maxAuditMinutes * 60_000 + 60_000));
      if (active.length >= 2) throw Object.assign(new Error('Two audits are already running. Please try again after one finishes.'), { statusCode: 429 });
      const now = new Date().toISOString();
      const audit: Audit = { id: randomUUID(), request, status: 'queued', createdAt: now, updatedAt: now, pageStates: [], progress: { phase: 'Queued', completedProfiles: 0, totalProfiles: request.profileIds.length } };
      await this.store.saveAudit(audit); await this.store.saveEvents?.(audit.id, []);
      const dispatch = this.dispatch(audit).catch(() => this.fail(audit.id, 'The worker could not be started. Check the server configuration.'));
      // Cloud Run may throttle CPU once the response ends. Submit the job before
      // returning 202; only the separate job continues in the background.
      if (this.config.executionMode === 'gcp') await dispatch;
      return audit;
    });
    this.admission = result.catch(() => undefined);
    return result;
  }
  async createDemo(): Promise<Audit> { return createSampleAudit(this.store); }
  private async dispatch(audit: Audit) {
    if (this.config.executionMode === 'gcp') {
      await new CloudRunJobAdapter({ project: this.config.gcpProject, region: this.config.gcpRegion, jobName: this.config.gcpJobName, bucket: this.config.gcsBucket }).launch(audit.id);
      return;
    }
    const entry = fileURLToPath(new URL('./worker-entry.ts', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      cwd: projectRoot,
      env: { ...process.env, BLINDSPOT_AUDIT_ID: audit.id, BLINDSPOT_DATA_DIR: this.config.dataDir,
        BLINDSPOT_EXECUTION_MODE: 'local', GEMINI_API_KEY: this.config.geminiApiKey ?? '', GEMINI_MODEL: this.config.geminiModel,
        BLINDSPOT_DEMO_TARGET: this.config.fixtureTarget ?? '', BLINDSPOT_MAX_AUDIT_MINUTES: String(this.config.maxAuditMinutes),
        BLINDSPOT_MAX_ACTIONS: String(this.config.maxActions), BLINDSPOT_MAX_PAGE_STATES: String(this.config.maxPageStates) },
      stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
    });
    this.children.set(audit.id, child);
    child.stderr?.on('data', () => undefined);
    const watchdog = setTimeout(() => { child.kill(); void this.fail(audit.id, 'Worker deadline exceeded; the last checkpoint is preserved.'); }, this.config.maxAuditMinutes * 60_000 + 15_000);
    watchdog.unref();
    child.once('error', () => { clearTimeout(watchdog); this.children.delete(audit.id); void this.fail(audit.id, 'The browser worker could not start.'); });
    child.once('exit', () => { clearTimeout(watchdog); this.children.delete(audit.id); void this.fail(audit.id, 'Worker exited before finishing; the last checkpoint is preserved.'); });
  }
  private async fail(id: string, message: string) {
    const audit = await this.store.loadAudit?.(id);
    if (!audit || terminalStatuses.includes(audit.status)) return;
    audit.status = await this.store.isCancelled?.(id) ? 'cancelled' : audit.pageStates.length ? 'partial' : 'failed';
    audit.error = message; audit.updatedAt = new Date().toISOString(); audit.progress.phase = audit.status;
    await this.store.saveAudit(audit);
  }
  async get(id: string): Promise<Audit | undefined> {
    const audit = await this.store.loadAudit?.(id);
    if (audit && !terminalStatuses.includes(audit.status) && Date.now() - Date.parse(audit.createdAt) > this.config.maxAuditMinutes * 60_000 + 60_000) {
      await this.fail(id, 'The execution stopped reporting progress before its deadline.'); return this.store.loadAudit?.(id);
    }
    return audit;
  }
  async getArtifact(id: string, artifactId: string) { return this.store.get(id, artifactId); }
  async getEvents(id: string, after = 0): Promise<AuditEvent[]> { return (await this.store.loadEvents?.(id) ?? []).filter(e => e.id > after); }
  async cancel(id: string): Promise<Audit | undefined> { const audit = await this.get(id); if (audit && !terminalStatuses.includes(audit.status)) await this.store.requestCancel?.(id); return audit; }
  async close() { for (const [id, child] of this.children) { await this.store.requestCancel?.(id); child.kill(); } this.children.clear(); }
}
