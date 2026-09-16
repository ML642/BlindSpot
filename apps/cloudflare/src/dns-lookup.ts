import { z } from 'zod';
import { boundedBytes } from './limits.js';

const answer = z.object({ Status: z.number(), Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional() });

export async function lookupAddresses(hostname: string) {
  const results = await Promise.all(['A', 'AAAA'].map(async type => {
    const endpoint = new URL('https://cloudflare-dns.com/dns-query');
    endpoint.searchParams.set('name', hostname);
    endpoint.searchParams.set('type', type);
    const response = await fetch(endpoint, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('DNS resolution unavailable.');
    const result = answer.parse(JSON.parse(new TextDecoder().decode(await boundedBytes(response.body, 16_384))));
    if (result.Status !== 0) throw new Error('DNS resolution failed.');
    return (result.Answer ?? []).filter(entry => entry.type === 1 || entry.type === 28).map(entry => ({ address: entry.data, family: entry.type === 1 ? 4 : 6 }));
  }));
  return results.flat();
}
