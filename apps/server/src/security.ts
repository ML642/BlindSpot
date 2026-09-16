import { lookupAddresses } from './dns-lookup.js';
import type { LookupAddress } from 'node:dns';
import net from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export interface SafeUrlOptions {
  fixtureTarget?: string;
  allowFixture?: boolean;
}

function ipv4Parts(address: string): number[] | undefined {
  if (!net.isIPv4(address)) return undefined;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255) ? parts : undefined;
}

const publicV6 = new net.BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
const restrictedV6 = new net.BlockList();
restrictedV6.addSubnet('2001::', 23, 'ipv6');
restrictedV6.addSubnet('2001:db8::', 32, 'ipv6');
restrictedV6.addSubnet('2002::', 16, 'ipv6');
restrictedV6.addSubnet('3fff::', 20, 'ipv6');
const mappedV4 = new net.BlockList();
mappedV4.addSubnet('::ffff:0:0', 96, 'ipv6');

export function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = ipv4Parts(normalized);
  if (v4) {
    const [a, b, c] = v4;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (!net.isIPv6(normalized)) return false;
  if (mappedV4.check(normalized, 'ipv6')) {
    // URL normalizes both dotted and expanded IPv6 forms to two hex words.
    const canonical = new URL(`http://[${normalized}]/`).hostname.slice(1, -1);
    const words = canonical.split(':').slice(-2).map(word => parseInt(word, 16));
    return isPrivateAddress([words[0] >> 8, words[0] & 255, words[1] >> 8, words[1] & 255].join('.'));
  }
  return !publicV6.check(normalized, 'ipv6') || restrictedV6.check(normalized, 'ipv6');
}

function sameUrl(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.protocol === right.protocol && left.hostname === right.hostname && left.port === right.port &&
      left.pathname === right.pathname && left.search === right.search;
  } catch {
    return false;
  }
}

export function isFixtureUrl(value: string, fixtureTarget?: string): boolean {
  return Boolean(fixtureTarget && sameUrl(value, fixtureTarget));
}

export async function assertSafeUrl(value: string, options: SafeUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeUrlError('The URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeUrlError('Only HTTP and HTTPS URLs are allowed.');
  if (url.username || url.password) throw new UnsafeUrlError('URLs containing credentials are not allowed.');

  const fixture = options.allowFixture && isFixtureUrl(value, options.fixtureTarget);
  if (fixture && isLoopbackHost(url.hostname)) return url;

  if (isPrivateAddress(url.hostname) || isMetadataHost(url.hostname)) {
    throw new UnsafeUrlError('Private, loopback and metadata addresses are not allowed.');
  }
  let addresses: LookupAddress[];
  try {
    addresses = await lookupAddresses(url.hostname);
  } catch {
    throw new UnsafeUrlError('The hostname could not be resolved.');
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UnsafeUrlError('The hostname resolves to a private or restricted address.');
  }
  return url;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === 'localhost.localdomain' ||
    (net.isIPv4(host) && host.split('.')[0] === '127') || host === '::1';
}

function isMetadataHost(hostname: string): boolean {
  return hostname === 'metadata.google.internal' || hostname === 'metadata' || hostname === '169.254.169.254';
}
