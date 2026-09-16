export const DEMO_LIMITS = {
  maxProfiles: 1,
  maxActions: 4,
  maxPageStates: 2,
  maxTurns: 3,
  timeoutMs: 120_000,
  auditsPerDay: 4,
  reservationMs: 150_000,
  retentionMs: 86_400_000,
  maxArtifactBytes: 2_000_000,
  maxAuditBytes: 12_000_000,
} as const;

export const SAMPLE_ID = '00000000-0000-4000-8000-000000000001';

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const result = Response.json(value, { status, headers });
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'no-referrer');
  return result;
}

export async function boundedBytes(body: ReadableStream<Uint8Array> | null, maximum: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) throw new Error('Response exceeds the demo size limit.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
