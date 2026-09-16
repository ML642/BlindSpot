import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://blindspot.test';
const target = 'https://audit.example.test/';
const input = { url: target, scenario: 'Inspect the navigation links and their names.', profileIds: ['blindness'] };
const pageHtml = '<!doctype html><html lang="en"><head><title>Audit fixture</title></head><body><header><nav aria-label="Main"><a href="/">Home</a><a href="/about">About</a></nav></header><main><h1>Welcome to the fixture</h1><p>Read the navigation and inspect this form.</p><form><input name="email" type="email" required><button type="button"><span aria-hidden="true">→</span></button></form></main></body></html>';

async function createRuntime({ apiKey = 'test-only-placeholder', browser = false } = {}) {
  const remote = browser && process.env.BLINDSPOT_REMOTE_BROWSER === '1'
    ? await (await import('wrangler')).startRemoteProxySession({ BROWSER: { type: 'browser', remote: true } }, { workerName: 'blindspot-demo-test' })
    : undefined;
  const calls = [];
  const options = {
    name: 'blindspot-test', modules: true, scriptPath: 'apps/cloudflare/dist/worker.js', unsafeInspectDurableObjects: true,
    compatibilityDate: '2026-09-16', compatibilityFlags: ['nodejs_compat'],
    bindings: { GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_API_KEY: apiKey },
    durableObjects: { DEMO_GATE: { className: 'DemoGate', useSQLite: true }, AUDIT_RUNNER: { className: 'AuditRunner', useSQLite: true } },
    assets: { directory: 'apps/web/dist', binding: 'ASSETS', run_worker_first: ['/api/*'], routerConfig: { has_user_worker: true } },
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ host: url.hostname, method: request.method, path: url.pathname });
      if (url.hostname === 'cloudflare-dns.com') return Response.json({ Status: 0, Answer: url.searchParams.get('type') === 'AAAA' ? [] : [{ type: 1, data: url.searchParams.get('name') === 'private.example.test' ? '10.0.0.1' : '93.184.215.14' }] });
      if (url.hostname === 'audit.example.test') return new Response(pageHtml, { headers: { 'Content-Type': 'text/html' } });
      if (url.hostname === 'generativelanguage.googleapis.com') {
        const body = await request.json();
        // Real model latency must not trigger the browser's ten-second idle timeout.
        const firstModelCall = calls.filter(call => call.host === url.hostname).length === 1;
        if (firstModelCall) await new Promise(resolve => setTimeout(resolve, 12_000));
        const parts = body.generationConfig?.responseMimeType === 'application/json'
          ? [{ text: JSON.stringify({ summary: 'Controlled provider fixture, not a live model result.', findings: [], checks: [] }) }]
          : firstModelCall ? [{ functionCall: { name: 'list_elements', args: { kind: 'links' } } }]
          : [{ functionCall: { name: 'finish', args: { outcome: 'completed', summary: 'The navigation was read through the virtual screen reader.' } } }];
        return Response.json({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] });
      }
      throw new Error(`Unexpected test egress: ${url.hostname}`);
    },
    ...(browser ? { browserRendering: { binding: 'BROWSER', remoteProxyConnectionString: remote?.remoteProxyConnectionString } } : { serviceBindings: { BROWSER: async () => new Response('Browser unavailable in this test', { status: 503 }) } }),
  };
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  return { mf, calls, dispose: async () => { await mf.dispose(); await remote?.dispose(); } };
}

function post(mf, path, value = input, headers = {}) {
  return mf.dispatchFetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
}

test('free demo validates requests, preserves a global quota, and serves a static sample without launching a browser', async () => {
  const { mf, calls, dispose } = await createRuntime();
  try {
    const initial = await (await mf.dispatchFetch(`${origin}/api/health`)).json();
    assert.equal(initial.demo.remaining, 4);
    assert.equal((await post(mf, '/api/audits', input, { origin: 'https://other.test' })).status, 403);
    assert.equal((await post(mf, '/api/audits', { ...input, profileIds: ['blindness', 'motor'] })).status, 400);
    assert.equal((await post(mf, '/api/audits', { ...input, url: 'http://127.0.0.1/' })).status, 400);
    assert.equal((await post(mf, '/api/audits', { ...input, url: 'http://private.example.test/' })).status, 400);
    assert.equal((await post(mf, '/api/audits', { ...input, scenario: 'x'.repeat(20_000) })).status, 413);
    const parallel = await Promise.all(Array.from({ length: 4 }, () => post(mf, '/api/audits')));
    assert.deepEqual(parallel.map(response => response.status).sort(), [202, 429, 429, 429]);
    const accepted = parallel.find(response => response.status === 202);
    const { id } = await accepted.json();
    assert.equal((await post(mf, `/api/audits/${id}/cancel`)).status, 200);
    assert.equal((await (await mf.dispatchFetch(`${origin}/api/audits/${id}`)).json()).status, 'cancelled');
    const storage = await mf.unsafeGetDurableObjectStorage('blindspot-test', 'DemoGate', { name: 'browser-allowance' });
    await storage.exec('UPDATE reservations SET started = ?', Date.now() - 180_000);
    for (let index = 0; index < 3; index++) await storage.exec('INSERT INTO reservations (id, started) VALUES (?, ?)', `used-${index}`, Date.now() - 180_000);
    assert.equal((await post(mf, '/api/audits')).status, 429);
    const { id: sampleId } = await (await post(mf, '/api/demo', {})).json();
    const sample = await (await mf.dispatchFetch(`${origin}/api/audits/${sampleId}`)).json();
    assert.equal(sample.demo, true);
    assert.ok(sample.report.findings.length > 0);
    const artifact = await mf.dispatchFetch(`${origin}/api/audits/${sampleId}/artifacts/${sample.pageStates[0].screenshotArtifactId}`);
    assert.equal(artifact.headers.get('content-type'), 'image/png');
    assert.ok((await artifact.arrayBuffer()).byteLength > 1000);
    assert.equal(calls.filter(call => call.host === 'generativelanguage.googleapis.com').length, 0);
    assert.equal((await mf.dispatchFetch(`${origin}/initialize`)).status, 404);
  } finally { await dispose(); }
});

test('missing Gemini credentials leaves sample usable and consumes no audit slots', async () => {
  const { mf, dispose } = await createRuntime({ apiKey: '' });
  try {
    assert.equal((await post(mf, '/api/audits')).status, 503);
    assert.equal((await post(mf, '/api/demo', {})).status, 201);
    assert.equal((await (await mf.dispatchFetch(`${origin}/api/health`)).json()).demo.remaining, 4);
  } finally { await dispose(); }
});

test('packaged Worker runs a real browser audit and preserves evidence with a controlled Gemini response', { timeout: 150_000 }, async () => {
  const { mf, calls, dispose } = await createRuntime({ browser: true });
  try {
    const response = await post(mf, '/api/audits');
    assert.equal(response.status, 202, await response.clone().text());
    const { id } = await response.json();
    let audit;
    for (let attempt = 0; attempt < 130; attempt++) {
      audit = await (await mf.dispatchFetch(`${origin}/api/audits/${id}`)).json();
      if (['completed', 'partial', 'failed', 'cancelled'].includes(audit.status)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(['completed', 'partial'].includes(audit.status), JSON.stringify(audit));
    assert.ok(audit.pageStates.length > 0, JSON.stringify(audit));
    assert.ok(audit.pageStates[0].speechArtifactId);
    assert.ok(audit.report.journeys[0].usedGemini, JSON.stringify(audit.report.journeys));
    assert.match(JSON.stringify(audit.report.journeys[0].steps), /Home/);
    assert.ok(calls.some(call => call.host === 'generativelanguage.googleapis.com'));
    const evidence = await mf.dispatchFetch(`${origin}/api/audits/${id}/artifacts/${audit.pageStates[0].screenshotArtifactId}`);
    assert.equal(evidence.headers.get('content-type'), 'image/png');
    assert.ok((await evidence.arrayBuffer()).byteLength > 1000);
    const speech = await (await mf.dispatchFetch(`${origin}/api/audits/${id}/artifacts/${audit.pageStates[0].speechArtifactId}`)).text();
    assert.match(speech, /Welcome to the fixture/);
    assert.ok(audit.report.limitations.some(value => value.includes('Free demo')));
    console.log(JSON.stringify({ result: audit.status, states: audit.pageStates.length, modelCalls: calls.filter(call => call.host === 'generativelanguage.googleapis.com').length }));
  } finally { await dispose(); }
});
