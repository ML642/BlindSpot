import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Audit } from '@blindspot/shared';
import { AuditManager } from '../apps/server/src/manager.js';
import { CloudRunJobAdapter } from '../apps/server/src/gcp-job.js';
import { loadConfig } from '../apps/server/src/config.js';

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
