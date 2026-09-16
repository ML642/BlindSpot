import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSampleAudit } from '../apps/server/src/sample.js';
import type { ArtifactStore } from '../apps/server/src/storage.js';
import type { Audit, AuditEvent } from '@blindspot/shared';
import { SAMPLE_ID } from '../apps/cloudflare/src/limits.js';

const directory = fileURLToPath(new URL('../apps/web/public/sample/', import.meta.url));
await rm(directory, { recursive: true, force: true });
await mkdir(`${directory}/artifacts`, { recursive: true });
const headers: string[] = [];
const store: ArtifactStore = {
  async put(_id, filename, content, contentType) {
    const id = crypto.randomUUID();
    const bytes = Buffer.from(content);
    await writeFile(`${directory}/artifacts/${id}`, bytes);
    headers.push(`/sample/artifacts/${id}\n  Content-Type: ${contentType}\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src 'none'; sandbox\n`);
    return { id, filename, contentType, size: bytes.length };
  },
  async get() { return undefined; },
  async saveAudit(audit: Audit) {
    await writeFile(`${directory}/audit.json`, JSON.stringify({ ...audit, id: SAMPLE_ID }));
  },
  async loadAudits() { return []; },
  async saveEvents(_id: string, events: AuditEvent[]) { await writeFile(`${directory}/events.json`, JSON.stringify({ events })); },
};
await createSampleAudit(store);
await writeFile('apps/web/public/_headers', headers.join('\n'));
console.log('Built a sample report from real local browser checks, with no Gemini calls.');
