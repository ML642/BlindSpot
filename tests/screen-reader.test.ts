import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BrowserSession } from '../apps/server/src/browser.js';
import type { ArtifactStore } from '../apps/server/src/storage.js';

test('screen-reader journey perceives the page only through speech and cannot submit a login', { timeout: 60_000 }, async () => {
  const html = await fs.readFile(new URL('../fixtures/login-modal.html', import.meta.url), 'utf8');
  const fixture = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const target = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/`;
  const artifacts = new Map<string, { content: Buffer; contentType: string }>();
  const store: ArtifactStore = {
    async put(_auditId, filename, body, contentType) { const id = randomUUID(); const content = Buffer.isBuffer(body) ? body : Buffer.from(body); artifacts.set(id, { content, contentType }); return { id, filename, contentType, size: content.length }; },
    async get(_auditId, id) { return artifacts.get(id); },
    async saveAudit() {}, async loadAudits() { return []; },
  };
  let session: BrowserSession | undefined;
  try {
    session = await BrowserSession.open({ mode: 'screen-reader', startUrl: target, fixtureTarget: target, auditId: randomUUID(), store, signal: new AbortController().signal, emit() {}, maxActions: 30, maxPageStates: 5, timeoutMs: 10_000, async onCapture() {} });
    const reader = session.screenReader;
    assert.ok(reader, 'screen-reader sessions carry a reader');
    const initial = session.snapshots[0];
    assert.equal(initial.state.journey, 'screen-reader');
    assert.ok(initial.speech?.includes('button, Sign in'), `read-through must speak the button: ${JSON.stringify(initial.speech)}`);
    assert.ok(initial.speech?.includes('heading, Example shop, level 1'));
    assert.ok(initial.state.speechArtifactId && artifacts.get(initial.state.speechArtifactId)?.content.toString().includes('main'));
    assert.deepEqual(await reader.list('headings'), ['heading, Example shop, level 1', 'heading, Returning customer, level 2']);
    const button = await reader.jump('next_button');
    assert.equal(button.current, 'button, Sign in');
    session.recordScreenReaderAction(button.current, 'activate');
    const opened = await reader.activate();
    assert.ok(opened.spoken.includes('dialog, Sign in'), `dialog must be announced: ${JSON.stringify(opened.spoken)}`);
    assert.ok(opened.spoken.some(phrase => phrase.startsWith('textbox, Email address')), 'focus moving into the dialog is announced');
    const captured = await session.captureIfChanged('activating the button');
    assert.match(captured?.state.description ?? '', /Dialog opened/);
    const typed = await reader.type('user@example.com');
    assert.match(typed.current, /user@example\.com/);
    await session.press({ key: 'Tab' });
    const focused = await reader.afterKey();
    assert.match(focused.current, /Password/);
    await assert.rejects(() => reader.type('secret'), /Credential entry is blocked/);
    await session.press({ key: 'Enter' });
    const notes = await session.drainGuard();
    assert.ok(notes.some(note => /blocked/i.test(note)), 'implicit submission through Enter is stopped by the page guard');
    assert.equal(await session.page.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).open), true, 'the login dialog stays open');
    assert.equal(await session.page.evaluate(() => document.querySelector('#status')?.textContent), '', 'the fixture submit handler never ran');
  } finally {
    await session?.close();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});
