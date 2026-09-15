import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import type { Duplex } from 'node:stream';
import { isPrivateAddress } from './security.js';

/** Browser egress goes through this proxy so DNS validation and the socket use
 * the same address. A second browser-side DNS lookup cannot rebind to metadata. */
export async function startNetworkProxy(options: { fixtureTarget?: string } = {}) {
  const sockets = new Set<Duplex>();
  const fixture = options.fixtureTarget ? new URL(options.fixtureTarget) : undefined;
  const track = <T extends Duplex>(socket: T): T => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    return socket;
  };

  async function destination(hostname: string, port: number) {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid destination port');
    const fixtureHost = fixture?.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const fixturePort = Number(fixture?.port || (fixture?.protocol === 'https:' ? 443 : 80));
    const fixtureAllowed = fixture && host === fixtureHost && port === fixturePort &&
      ['localhost', '127.0.0.1', '::1'].includes(host);
    const addresses = net.isIP(host)
      ? [{ address: host, family: net.isIP(host) }]
      : await dns.lookup(host, { all: true, verbatim: true });
    if (!addresses.length || (!fixtureAllowed && addresses.some(a => isPrivateAddress(a.address)))) {
      throw new Error('Destination is not a public address');
    }
    if (fixtureAllowed && addresses.some(a => !['127.0.0.1', '::1'].includes(a.address))) {
      throw new Error('Fixture must resolve to loopback');
    }
    return addresses.find(a => a.family === 4) ?? addresses[0];
  }

  const server = http.createServer(async (request, response) => {
    try {
      const target = new URL(request.url ?? '');
      if (target.protocol !== 'http:' || target.username || target.password) throw new Error('Invalid proxy URL');
      const port = Number(target.port || 80);
      const address = await destination(target.hostname, port);
      const headers: http.OutgoingHttpHeaders = { ...request.headers, host: target.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const upstream = http.request({
        hostname: address.address, family: address.family, port,
        path: target.pathname + target.search, method: request.method, headers,
        agent: false, timeout: 25_000,
      }, incoming => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      });
      upstream.on('socket', track);
      upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end('Browser destination unavailable');
      });
      response.on('close', () => upstream.destroy());
      request.pipe(upstream);
    } catch {
      response.writeHead(403, { 'content-type': 'text/plain' });
      response.end('Browser destination blocked');
    }
  });

  server.on('connect', async (request, rawSocket, head) => {
    const client = track(rawSocket);
    client.on('error', () => client.destroy());
    try {
      const target = new URL(`https://${request.url ?? ''}`);
      if (target.username || target.password || target.pathname !== '/') throw new Error('Invalid tunnel');
      // CONNECT is restricted to TLS port 443; fixture tests use plain HTTP.
      const port = Number(target.port || 443);
      if (port !== 443) throw new Error('TLS tunnels require port 443');
      const address = await destination(target.hostname, port);
      if (client.destroyed) return;
      const upstream = track(net.connect({ host: address.address, port, family: address.family }));
      upstream.setTimeout(30_000, () => upstream.destroy());
      upstream.on('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });
  server.on('connection', socket => {
    track(socket);
    socket.on('error', () => socket.destroy());
    socket.setTimeout(30_000, () => socket.destroy());
  });
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
