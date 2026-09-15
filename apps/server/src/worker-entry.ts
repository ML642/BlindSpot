import { z } from 'zod';
import type { AuditEvent } from '@blindspot/shared';
import { loadConfig } from './config.js';
import { createArtifactStore } from './storage.js';
import { runAuditJob } from './worker.js';

const config = loadConfig();
const id = z.string().uuid().parse(process.env.BLINDSPOT_AUDIT_ID);
const store = await createArtifactStore(config.dataDir, config.executionMode === 'gcp' ? config.gcsBucket : undefined);
const audit = await store.loadAudit?.(id);
if (!audit) throw new Error('Audit record was not found.');
const controller = new AbortController();
let timedOut = false;
const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, config.maxAuditMinutes * 60_000);
const cancellation = setInterval(() => { void store.isCancelled?.(id).then(cancelled => { if (cancelled) controller.abort(); }).catch(() => controller.abort()); }, config.executionMode === 'gcp' ? 2000 : 300);
const events: AuditEvent[] = await store.loadEvents?.(id) ?? [];
let persistence = Promise.resolve();
const save = () => {
  const snapshot = structuredClone(audit);
  const log = structuredClone(events);
  persistence = persistence.then(async () => { await store.saveAudit(snapshot); await store.saveEvents?.(id, log); });
  return persistence;
};
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => controller.abort());
try {
  if (await store.isCancelled?.(id)) controller.abort();
  audit.status = 'running'; await save();
  const result = await runAuditJob({ id, request: audit.request, geminiApiKey: config.geminiApiKey, geminiModel: config.geminiModel, fixtureTarget: config.executionMode === 'local' ? config.fixtureTarget : undefined,
    limits: { maxActions: config.maxActions, maxPageStates: config.maxPageStates, timeoutMs: Math.min(30_000, config.maxAuditMinutes * 60_000) } }, {
    store, signal: controller.signal,
    emit(event) {
      events.push({ ...event, id: (events.at(-1)?.id ?? 0) + 1, timestamp: new Date().toISOString() });
      audit.updatedAt = new Date().toISOString();
      if (event.type === 'status') audit.progress.phase = event.message;
      if (event.profileId && event.message.includes('review finished')) audit.progress.completedProfiles++;
      void save().catch(() => controller.abort());
    },
    async checkpoint(result) { audit.pageStates = result.pageStates; audit.report = result.report; audit.updatedAt = new Date().toISOString(); await save(); },
  });
  Object.assign(audit, result);
  if (timedOut) { audit.status = audit.pageStates.length ? 'partial' : 'failed'; audit.error = 'The audit reached its time limit. Captured evidence is preserved.'; }
  audit.updatedAt = new Date().toISOString(); audit.progress.phase = audit.status;
  audit.progress.completedProfiles = audit.report?.profiles.length ?? 0;
  await save();
} finally { clearTimeout(deadline); clearInterval(cancellation); }
