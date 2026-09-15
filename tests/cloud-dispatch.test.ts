import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Audit } from '@blindspot/shared';
import { AuditManager } from '../apps/server/src/manager.js';
import { CloudRunJobAdapter } from '../apps/server/src/gcp-job.js';
import { loadConfig } from '../apps/server/src/config.js';

test('audit concurrency defaults and overrides', () => {
  assert.equal(loadConfig({}).maxConcurrentAudits, 2);
  assert.equal(loadConfig({ BLINDSPOT_EXECUTION_MODE: 'gcp' }).maxConcurrentAudits, 15);
  assert.equal(loadConfig({ BLINDSPOT_MAX_CONCURRENT_AUDITS: '12' }).maxConcurrentAudits, 12);
  assert.equal(loadConfig({ BLINDSPOT_EXECUTION_MODE: 'gcp', BLINDSPOT_MAX_CONCURRENT_AUDITS: '0' }).maxConcurrentAudits, 15);
});

test('cloud admits 15 simultaneous requests, rejects the 16th, and reuses a finished slot', async t => {
  let launches = 0;
  t.mock.method(CloudRunJobAdapter.prototype, 'launch', async () => { launches++; return { executionName: 'test-execution' }; });
  const audits = new Map<string, Audit>();
  const manager = new AuditManager({ ...loadConfig({ BLINDSPOT_EXECUTION_MODE: 'gcp' }), geminiApiKey: 'test-only' }, {
    async put() { throw new Error('Not used by this test'); }, async get() { return undefined; },
    async saveAudit(audit) { audits.set(audit.id, audit); }, async loadAudits() { return [...audits.values()]; },
    async loadAudit(id) { return audits.get(id); },
  });
  const request = { url: 'https://93.184.216.34', scenario: 'Inspect homepage accessibility', profileIds: ['blindness'] };
  const results = await Promise.allSettled(Array.from({ length: 16 }, () => manager.create(request)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 15);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected?.reason.statusCode, 429);
  assert.match(rejected?.reason.message, /15 audit slots/);
  assert.equal(launches, 15);
  const first = [...audits.values()][0];
  first.status = 'completed';
  assert.equal((await manager.create(request)).status, 'queued');
  assert.equal(launches, 16);
});

test('cloud creation waits for job submission before returning the audit', async t => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const launchStarted = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(CloudRunJobAdapter.prototype, 'launch', async () => {
    started(); await gate; return { executionName: 'test-execution' };
  });
  const audits = new Map<string, Audit>();
  const manager = new AuditManager({ ...loadConfig({}), executionMode: 'gcp', geminiApiKey: 'test-only' }, {
    async put() { throw new Error('Not used by this test'); }, async get() { return undefined; },
    async saveAudit(audit) { audits.set(audit.id, audit); }, async loadAudits() { return [...audits.values()]; },
    async loadAudit(id) { return audits.get(id); },
  });
  let returned = false;
  const pending = manager.create({ url: 'https://93.184.216.34', scenario: 'Inspect homepage accessibility', profileIds: ['blindness'] }).then(audit => { returned = true; return audit; });
  await launchStarted;
  try { assert.equal(returned, false); } finally { release(); }
  assert.equal((await pending).status, 'queued');
});
