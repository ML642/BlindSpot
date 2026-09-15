export class AccessBlockedError extends Error {
  constructor(message: string) { super(message); this.name = 'AccessBlockedError'; }
}

export function detectAccessBlock(input: { mitigated?: string; status?: number; title: string; text: string; html: string }): string | undefined {
  if (input.mitigated?.toLowerCase() === 'challenge') return 'Cloudflare challenge detected (cf-mitigated: challenge). The site requires verification; the audit stopped without retrying or solving it.';
  if (input.status === 403 || input.status === 429) return `Access blocked by HTTP ${input.status}. The audit stopped without retrying; request access from the site owner.`;
  const interstitial = /^(just a moment|attention required|security verification|verify (you are|you're) human)/i.test(input.title.trim());
  const verification = /verify (you are|you're) human|checking your browser|performing security verification|enable javascript and cookies to continue/i.test(input.text);
  const cloudflare = /cloudflare|\/cdn-cgi\/challenge-platform|cf-chl-/i.test(input.html);
  if (interstitial && verification && cloudflare) return 'Cloudflare verification page detected. The audit stopped; ask the site owner to authorize the audit or use an accessible staging environment.';
  return undefined;
}
