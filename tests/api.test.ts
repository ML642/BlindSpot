import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config.js';
import { terminalStatuses, type Audit } from '@blindspot/shared';

test('API sample, validation, persisted evidence and no-key behavior', { timeout: 45_000 }, async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blindspot-api-'));
  const app = await createApp({ ...loadConfig({}), dataDir });
  try {
    assert.equal((await app.inject('/api/health')).json().geminiConfigured, false);
    const invalid = await app.inject({ method: 'POST', url: '/api/audits', payload: { url: 'http://127.0.0.1', scenario: 'Find the login form', profileIds: ['blindness'] } });
    assert.equal(invalid.statusCode, 400);
    const sample = await app.inject({ method: 'POST', url: '/api/demo' });
    assert.equal(sample.statusCode, 201, sample.body);
    const id = sample.json().id;
    const audit = (await app.inject(`/api/audits/${id}`)).json<Audit>();
    assert.equal(audit.demo, true); assert.ok(audit.report?.findings.length);
    const artifact = await app.inject(`/api/audits/${id}/artifacts/${audit.pageStates[0].domArtifactId}`);
    assert.match(String(artifact.headers['content-type']), /text\/plain/);
    assert.equal(artifact.headers['x-content-type-options'], 'nosniff');
    assert.match(String(artifact.headers['content-disposition']), /attachment/);
    assert.equal((await app.inject(`/api/audits/${id}/events?after=1`)).json().events.length, 0);
  } finally { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('separate worker persists SPA states, events and a partial tool-only fixture report', { timeout: 60_000 }, async () => {
  const html = await fs.readFile(new URL('../fixtures/login-modal.html', import.meta.url), 'utf8');
  const fixture = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  const target = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blindspot-worker-'));
  const app = await createApp({ ...loadConfig({}), dataDir, fixtureTarget: target });
  try {
    const started = await app.inject({ method: 'POST', url: '/api/audits', payload: { url: target, scenario: 'Find and inspect the login form', profileIds: ['blindness', 'motor'] } });
    assert.equal(started.statusCode, 202, started.body);
    const id = started.json().id;
    let audit: Audit | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      audit = (await app.inject(`/api/audits/${id}`)).json<Audit>();
      if (terminalStatuses.includes(audit.status)) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert.equal(audit?.status, 'partial', JSON.stringify(audit));
    assert.ok(audit.pageStates.length >= 2);
    assert.equal(audit.pageStates[0].url, audit.pageStates[1].url);
    assert.ok(audit.report?.profiles.every(p => p.checks.some(c => c.method === 'gemini' && c.status === 'blocked')), JSON.stringify({ error: audit.error, profiles: audit.report?.profiles, journeys: audit.report?.journeys }));
    assert.ok((await app.inject(`/api/audits/${id}/events`)).json().events.length > 1);
    // Cancellation is persisted even if it arrives before worker startup.
    const second = await app.inject({ method: 'POST', url: '/api/audits', payload: { url: target, scenario: 'Find and inspect the login form', profileIds: ['blindness'] } });
    const cancelId = second.json().id;
    await app.inject({ method: 'POST', url: `/api/audits/${cancelId}/cancel` });
    for (let attempt = 0; attempt < 70; attempt++) {
      const cancelled = (await app.inject(`/api/audits/${cancelId}`)).json<Audit>();
      if (cancelled.status === 'cancelled') return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.fail('The cancellation did not reach the worker');
  } finally { await app.close(); await new Promise<void>(resolve => fixture.close(() => resolve())); await fs.rm(dataDir, { recursive: true, force: true }); }
});
