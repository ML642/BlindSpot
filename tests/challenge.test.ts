import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { detectAccessBlock } from '../apps/server/src/challenge.js';
import { runAuditJob } from '../apps/server/src/worker.js';

test('challenge detection uses response metadata or combined interstitial signals, not Cloudflare branding alone', () => {
  const normal = { title: 'Login', text: 'Sign in', html: '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>' };
  assert.equal(detectAccessBlock(normal), undefined);
  assert.match(detectAccessBlock({ ...normal, mitigated: 'challenge' })!, /Cloudflare/);
  assert.match(detectAccessBlock({ ...normal, status: 429 })!, /429/);
  assert.match(detectAccessBlock({ title: 'Just a moment...', text: 'Verify you are human', html: '<div>Cloudflare</div>' })!, /verification/);
  assert.equal(detectAccessBlock({ ...normal, title: 'Cloudflare challenge troubleshooting', text: 'Verify you are human documentation' }), undefined);
});

for (const header of [true, false]) test(`challenge stops entire worker and preserves evidence (header=${header})`, { timeout: 25000 }, async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(header ? 403 : 200, { 'content-type': 'text/html', ...(header ? { 'cf-mitigated': 'challenge' } : {}) });
    res.end('<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Verify you are human</h1><p>Cloudflare security verification</p></body></html>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const messages: string[] = [];
  try {
    const result = await runAuditJob({ id: randomUUID(), request: { url, scenario: 'Find and inspect sign in', profileIds: ['blindness', 'motor'] }, geminiModel: 'not-a-real-model', fixtureTarget: url, limits: { maxActions: 30, maxPageStates: 5, timeoutMs: 10000 } }, {
      signal: new AbortController().signal, emit: e => messages.push(e.message),
      store: { async put(_id, filename, body, contentType) { return { id: randomUUID(), filename, size: body.length, contentType }; }, async get() { return undefined; }, async saveAudit() {}, async loadAudits() { return []; } },
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.report?.scenarioOutcome, 'blocked');
    assert.equal(result.pageStates.length, 1);
    assert.ok(result.pageStates[0].screenshotArtifactId);
    assert.equal(result.report?.findings.length, 0, 'do not audit the challenge as the target site');
    assert.ok(result.report?.profiles.every(p => p.status === 'blocked'));
    assert.ok(!messages.some(m => /specialist|Gemini/i.test(m)), 'no model review or retries after challenge');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
