import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BrowserSession } from '../apps/server/src/browser.js';
import type { ArtifactStore } from '../apps/server/src/storage.js';

test('browser captures a same-URL sign-in dialog with real DOM, ARIA and screenshot evidence', { timeout: 45_000 }, async () => {
  const fixture = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><html lang="en"><head><title>Journey fixture</title></head><body><main><h1>Welcome</h1><button id="open" onclick="document.querySelector('dialog').showModal()">Sign in</button><dialog aria-labelledby="heading"><h2 id="heading">Sign in</h2><form><label for="email">Email</label><input id="email" type="email" required><label for="password">Password</label><input id="password" type="password" required><button type="submit">Continue</button></form></dialog></main></body></html>`);
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const target = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/`;
  const artifacts = new Map<string, { content: Buffer; contentType: string }>();
  const store: ArtifactStore = {
    async put(_auditId, filename, body, contentType) {
      const id = randomUUID();
      const content = Buffer.isBuffer(body) ? body : Buffer.from(body);
      artifacts.set(id, { content, contentType });
      return { id, filename, contentType, size: content.length };
    },
    async get(_auditId, id) { return artifacts.get(id); },
    async saveAudit() {},
    async loadAudits() { return []; },
  };
  let session: BrowserSession | undefined;
  try {
    session = await BrowserSession.open({ startUrl: target, fixtureTarget: target, auditId: randomUUID(), store, signal: new AbortController().signal, emit() {}, maxActions: 30, maxPageStates: 5, timeoutMs: 10_000 });
    const before = session.snapshots[0];
    const after = await session.click({ selector: '#open' });
    assert.equal(before.state.url, after.state.url);
    assert.notEqual(before.state.id, after.state.id);
    assert.match(after.accessibility, /dialog.*Sign in/i);
    assert.match(after.dom, /<dialog[^>]*open/);
    assert.ok(after.state.screenshotArtifactId);
    const screenshot = artifacts.get(after.state.screenshotArtifactId!);
    assert.equal(screenshot?.contentType, 'image/png');
    assert.ok((screenshot?.content.length ?? 0) > 1000);
    await assert.rejects(() => session!.type({ selector: '#password', text: 'secret' }), /credential|password/i);
  } finally {
    await session?.close();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});
