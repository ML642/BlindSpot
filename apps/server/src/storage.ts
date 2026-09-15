import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEvent } from '@blindspot/shared';

export interface StoredArtifact {
  id: string;
  contentType: string;
  size: number;
  filename: string;
}

export interface ArtifactStore {
  put(auditId: string, filename: string, content: Buffer | string, contentType: string): Promise<StoredArtifact>;
  get(auditId: string, artifactId: string): Promise<{ content: Buffer; contentType: string } | undefined>;
  saveAudit(audit: Audit): Promise<void>;
  loadAudits(): Promise<Audit[]>;
  loadAudit?(id: string): Promise<Audit | undefined>;
  saveEvents?(id: string, events: AuditEvent[]): Promise<void>;
  loadEvents?(id: string): Promise<AuditEvent[]>;
  requestCancel?(id: string): Promise<void>;
  isCancelled?(id: string): Promise<boolean>;
}

function safeSegment(value: string): string {
  if (value === '.' || value === '..' || !/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error('Invalid storage path segment');
  return value;
}

export class LocalArtifactStore implements ArtifactStore {
  readonly root: string;
  constructor(root: string) { this.root = root; }

  async init(): Promise<void> { await fs.mkdir(path.join(this.root, 'audits'), { recursive: true }); }

  private auditDir(auditId: string): string { return path.join(this.root, 'audits', safeSegment(auditId)); }

  async loadAudit(id: string): Promise<Audit | undefined> { try { return JSON.parse(await fs.readFile(path.join(this.auditDir(id), 'audit.json'), 'utf8')); } catch { return undefined; } }
  async saveEvents(id: string, events: AuditEvent[]): Promise<void> {
    const file = path.join(this.auditDir(id), 'events.json');
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(events)); await fs.rename(temp, file);
  }
  async loadEvents(id: string): Promise<AuditEvent[]> { try { return JSON.parse(await fs.readFile(path.join(this.auditDir(id), 'events.json'), 'utf8')); } catch { return []; } }
  async requestCancel(id: string): Promise<void> { await fs.writeFile(path.join(this.auditDir(id), 'cancel'), 'cancel'); }
  async isCancelled(id: string): Promise<boolean> { try { await fs.access(path.join(this.auditDir(id), 'cancel')); return true; } catch { return false; } }

  async put(auditId: string, filename: string, content: Buffer | string, contentType: string): Promise<StoredArtifact> {
    const id = randomUUID();
    const cleanName = `${safeSegment(id)}-${safeSegment(filename.replace(/[^a-zA-Z0-9._-]/g, '_'))}`;
    const dir = this.auditDir(auditId);
    await fs.mkdir(dir, { recursive: true });
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    await fs.writeFile(path.join(dir, cleanName), body, { flag: 'wx' });
    await fs.writeFile(path.join(dir, `${id}.meta.json`), JSON.stringify({ id, filename, contentType, size: body.byteLength }), { flag: 'wx' });
    return { id, contentType, size: body.byteLength, filename };
  }

  async get(auditId: string, artifactId: string): Promise<{ content: Buffer; contentType: string } | undefined> {
    safeSegment(auditId); safeSegment(artifactId);
    const dir = this.auditDir(auditId);
    let meta: { id: string; contentType: string; filename: string };
    try { meta = JSON.parse(await fs.readFile(path.join(dir, `${artifactId}.meta.json`), 'utf8')) as typeof meta; } catch { return undefined; }
    const entries = await fs.readdir(dir);
    const dataName = entries.find((entry) => entry.startsWith(`${artifactId}-`) && !entry.endsWith('.meta.json'));
    if (!dataName) return undefined;
    try { return { content: await fs.readFile(path.join(dir, dataName)), contentType: meta.contentType }; } catch { return undefined; }
  }

  async saveAudit(audit: Audit): Promise<void> {
    const dir = this.auditDir(audit.id);
    await fs.mkdir(dir, { recursive: true });
    const temp = path.join(dir, `audit-${randomUUID()}.tmp`);
    await fs.writeFile(temp, JSON.stringify(audit, null, 2), 'utf8');
    await fs.rename(temp, path.join(dir, 'audit.json'));
  }

  async loadAudits(): Promise<Audit[]> {
    const base = path.join(this.root, 'audits');
    try { await fs.mkdir(base, { recursive: true }); } catch { return []; }
    const entries = await fs.readdir(base, { withFileTypes: true });
    const audits: Audit[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try { audits.push(JSON.parse(await fs.readFile(path.join(base, entry.name, 'audit.json'), 'utf8')) as Audit); } catch { /* an incomplete directory is safe to ignore */ }
    }
    return audits;
  }
}

export class GcsArtifactStore implements ArtifactStore {
  private readonly bucket: any;
  private readonly prefix: string;
  private constructor(bucket: any, prefix: string) { this.bucket = bucket; this.prefix = prefix.replace(/^\/+|\/+$/g, ''); }

  static async create(bucketName: string, prefix = 'blindspot'): Promise<GcsArtifactStore> {
    const modName = '@google-cloud/storage';
    const { Storage } = await import(modName);
    const storage = new Storage();
    return new GcsArtifactStore(storage.bucket(bucketName), prefix);
  }

  private key(auditId: string, filename: string): string { return `${this.prefix}/audits/${safeSegment(auditId)}/${filename}`; }

  async loadAudit(id: string): Promise<Audit | undefined> { try { const [body] = await this.bucket.file(this.key(id, 'audit.json')).download(); return JSON.parse(body.toString()); } catch (error: any) { if (error.code === 404) return undefined; throw error; } }
  async saveEvents(id: string, events: AuditEvent[]): Promise<void> { await this.bucket.file(this.key(id, 'events.json')).save(JSON.stringify(events), { resumable: false }); }
  async loadEvents(id: string): Promise<AuditEvent[]> { try { const [body] = await this.bucket.file(this.key(id, 'events.json')).download(); return JSON.parse(body.toString()); } catch (error: any) { if (error.code === 404) return []; throw error; } }
  async requestCancel(id: string): Promise<void> { await this.bucket.file(this.key(id, 'cancel')).save('cancel', { resumable: false }); }
  async isCancelled(id: string): Promise<boolean> { const [exists] = await this.bucket.file(this.key(id, 'cancel')).exists(); return exists; }

  async put(auditId: string, filename: string, content: Buffer | string, contentType: string): Promise<StoredArtifact> {
    const id = randomUUID(); const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const objectName = this.key(auditId, `${id}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    await this.bucket.file(objectName).save(body, { resumable: false, metadata: { contentType } });
    await this.bucket.file(this.key(auditId, `${id}.meta.json`)).save(JSON.stringify({ id, filename, contentType, size: body.length }), { resumable: false, metadata: { contentType: 'application/json' } });
    return { id, contentType, size: body.length, filename };
  }

  async get(auditId: string, artifactId: string): Promise<{ content: Buffer; contentType: string } | undefined> {
    safeSegment(auditId); safeSegment(artifactId);
    const [metaFiles] = await this.bucket.getFiles({ prefix: this.key(auditId, `${artifactId}.meta.json`) });
    if (!metaFiles.length) return undefined;
    const [metaBody] = await metaFiles[0].download();
    const meta = JSON.parse(metaBody.toString('utf8')) as { contentType: string };
    const [files] = await this.bucket.getFiles({ prefix: this.key(auditId, `${artifactId}-`) });
    if (!files.length) return undefined;
    const [content] = await files[0].download();
    return { content, contentType: meta.contentType };
  }

  async saveAudit(audit: Audit): Promise<void> {
    await this.bucket.file(this.key(audit.id, 'audit.json')).save(JSON.stringify(audit, null, 2), { resumable: false, metadata: { contentType: 'application/json' } });
  }

  async loadAudits(): Promise<Audit[]> {
    const [files] = await this.bucket.getFiles({ prefix: `${this.prefix}/audits/`, matchGlob: '**/audit.json' });
    const audits: Audit[] = [];
    for (const file of files) { try { const [body] = await file.download(); audits.push(JSON.parse(body.toString('utf8')) as Audit); } catch { /* skip incomplete records */ } }
    return audits;
  }
}

export async function createArtifactStore(dataDir: string, bucket?: string): Promise<ArtifactStore> {
  if (bucket) return GcsArtifactStore.create(bucket);
  const store = new LocalArtifactStore(dataDir); await store.init(); return store;
}
