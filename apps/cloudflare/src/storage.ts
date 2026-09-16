import type { Audit, AuditEvent } from '@blindspot/shared';
import type { ArtifactStore, StoredArtifact } from '../../server/src/storage.js';
import { DEMO_LIMITS } from './limits.js';

type Manifest = StoredArtifact & { chunks: number };
const CHUNK_SIZE = 64_000;

export class DurableArtifactStore implements ArtifactStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async put(_auditId: string, filename: string, content: Buffer | string, contentType: string): Promise<StoredArtifact> {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (bytes.length > DEMO_LIMITS.maxArtifactBytes) {
      throw new Error('Evidence exceeds the demo storage limit.');
    }
    const id = crypto.randomUUID();
    const chunks = Math.ceil(bytes.length / CHUNK_SIZE);
    const manifest: Manifest = { id, filename, contentType, size: bytes.length, chunks };
    const entries: Record<string, unknown> = { [`artifact:${id}`]: manifest };
    for (let index = 0; index < chunks; index++) entries[`chunk:${id}:${index}`] = Uint8Array.from(bytes.subarray(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
    await this.storage.transaction(async transaction => {
      const used = await transaction.get<number>('artifactBytes') ?? 0;
      if (used + bytes.length > DEMO_LIMITS.maxAuditBytes) throw new Error('Evidence exceeds the demo storage limit.');
      await transaction.put({ ...entries, artifactBytes: used + bytes.length });
    });
    return manifest;
  }

  async get(_auditId: string, artifactId: string) {
    const manifest = await this.storage.get<Manifest>(`artifact:${artifactId}`);
    if (!manifest) return undefined;
    const keys = Array.from({ length: manifest.chunks }, (_, index) => `chunk:${artifactId}:${index}`);
    const data = await this.storage.get<Uint8Array>(keys);
    const chunks: Buffer[] = [];
    for (const key of keys) { const chunk = data.get(key); if (!chunk) return undefined; chunks.push(Buffer.from(chunk)); }
    return { content: Buffer.concat(chunks), contentType: manifest.contentType };
  }

  async saveAudit(audit: Audit) { await this.storage.put('audit', audit); }
  async loadAudit(_id: string) { return this.storage.get<Audit>('audit'); }
  async loadAudits() { const audit = await this.storage.get<Audit>('audit'); return audit ? [audit] : []; }
  async saveEvents(_id: string, events: AuditEvent[]) { await this.storage.put('events', events.slice(-150)); }
  async loadEvents(_id: string) { return await this.storage.get<AuditEvent[]>('events') ?? []; }
  async requestCancel(_id: string) { await this.storage.put('cancelled', true); }
  async isCancelled(_id: string) { return await this.storage.get<boolean>('cancelled') ?? false; }
}
