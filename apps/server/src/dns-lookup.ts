import dns from 'node:dns/promises';

export const lookupAddresses = (hostname: string) => dns.lookup(hostname, { all: true, verbatim: true });
