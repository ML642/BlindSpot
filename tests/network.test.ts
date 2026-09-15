import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { startNetworkProxy } from '../apps/server/src/network-proxy.js';
import { assertSafeUrl, isPrivateAddress } from '../apps/server/src/security.js';

test('public-destination classification rejects loopback, metadata and private variants', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('audit URL guard rejects credential URLs and alternate loopback notation', async () => {
  for (const url of ['http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://user:password@example.com', 'file:///etc/passwd']) {
    await assert.rejects(() => assertSafeUrl(url), undefined, url);
  }
});

function proxyGet(proxy: string, target: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.get(proxy, { path: target }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('error', reject);
  });
}

test('proxy rejects private HTTP destinations and only admits explicit fixture origin', async () => {
  let visited = 0;
  const fixture = http.createServer((_request, response) => { visited++; response.end('fixture evidence'); });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const target = `http://127.0.0.1:${(fixture.address() as net.AddressInfo).port}`;
  const blocked = await startNetworkProxy();
  const allowed = await startNetworkProxy({ fixtureTarget: target + '/broken' });
  try {
    assert.equal((await proxyGet(blocked.url, target + '/private')).status, 403);
    assert.equal(visited, 0);
    const result = await proxyGet(allowed.url, target + '/login');
    assert.equal(result.status, 200);
    assert.equal(result.body, 'fixture evidence');
    assert.equal(visited, 1);
    assert.equal((await proxyGet(allowed.url, 'http://169.254.169.254/computeMetadata/v1/')).status, 403);
    assert.equal((await proxyGet(allowed.url, 'http://127.0.0.1:1/')).status, 403);
  } finally {
    await blocked.close();
    await allowed.close();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});

test('proxy refuses private TLS CONNECT destinations', async () => {
  const proxy = await startNetworkProxy();
  const proxyUrl = new URL(proxy.url);
  const socket = net.connect(Number(proxyUrl.port), proxyUrl.hostname);
  try {
    await once(socket, 'connect');
    socket.write('CONNECT 169.254.169.254:443 HTTP/1.1\r\nHost: 169.254.169.254:443\r\n\r\n');
    const [data] = await once(socket, 'data');
    assert.match(data.toString(), /403 Forbidden/);
  } finally {
    socket.destroy();
    await proxy.close();
  }
});
