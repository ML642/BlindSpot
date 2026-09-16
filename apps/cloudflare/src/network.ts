import type { Route } from '@cloudflare/playwright';
import { assertSafeUrl, UnsafeUrlError } from '../../server/src/security.js';
import { boundedBytes } from './limits.js';

export async function publicTarget(value: string): Promise<URL> {
  const url = new URL(value);
  if (!url.hostname.includes('.') || url.hostname.includes(':') || /^[\d.]+$/.test(url.hostname) || url.port) {
    throw new UnsafeUrlError('Use a public website hostname on the default HTTP or HTTPS port.');
  }
  return assertSafeUrl(value);
}

export function networkRoute(signal: AbortSignal): (route: Route) => Promise<void> {
  return async route => {
    try {
      const request = route.request();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || ['media', 'websocket'].includes(request.resourceType())) {
        await route.abort('blockedbyclient'); return;
      }
      const url = await publicTarget(request.url());
      const headers = new Headers();
      for (const name of ['accept', 'accept-language', 'user-agent']) {
        const value = request.headers()[name];
        if (value) headers.set(name, value);
      }
      // Browser Run denies all direct egress. Fulfil intercepted requests through
      // the public Workers fetch network; never let Chromium resolve destinations.
      const response = await fetch(url, { method: request.method(), headers, redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
      const body = await boundedBytes(response.body, 5_000_000);
      const responseHeaders = Object.fromEntries(response.headers);
      for (const name of ['content-encoding', 'content-length', 'set-cookie']) delete responseHeaders[name];
      await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.from(body) });
    } catch { await route.abort('blockedbyclient').catch(() => undefined); }
  };
}
