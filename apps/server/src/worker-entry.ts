import readline from 'node:readline';
import { loadConfig } from './config.js';
import { createArtifactStore } from './storage.js';
import { runAuditJob, type AuditJob } from './worker.js';

type StartMessage = { type: 'start'; job: AuditJob };
type CancelMessage = { type: 'cancel'; auditId: string };

function send(message: unknown): void { process.stdout.write(`${JSON.stringify(message)}\n`); }

const config = loadConfig();
const controllers = new Map<string, AbortController>();
let running = false;

async function run(job: AuditJob): Promise<void> {
  if (running) { send({ type: 'error', auditId: job.id, error: 'Worker accepts one audit per process.' }); return; }
  running = true;
  const controller = new AbortController(); controllers.set(job.id, controller);
  try {
    const store = await createArtifactStore(config.dataDir, config.gcsBucket);
    const result = await runAuditJob(job, {
      store,
      signal: controller.signal,
      emit: (event) => send({ type: 'event', auditId: job.id, event }),
    });
    send({ type: 'done', auditId: job.id, result });
  } catch (error) {
    send({ type: 'error', auditId: job.id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    controllers.delete(job.id); running = false;
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  try {
    const message = JSON.parse(line) as StartMessage | CancelMessage;
    if (message.type === 'start') void run(message.job);
    else if (message.type === 'cancel') controllers.get(message.auditId)?.abort();
  } catch { send({ type: 'error', error: 'Invalid worker message.' }); }
});

if (process.env.BLINDSPOT_JOB_PAYLOAD) {
  try {
    const job = JSON.parse(process.env.BLINDSPOT_JOB_PAYLOAD) as AuditJob;
    void run(job).finally(() => setTimeout(() => process.exit(0), 50));
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    setTimeout(() => process.exit(1), 50);
  }
}

process.on('SIGTERM', () => { for (const controller of controllers.values()) controller.abort(); setTimeout(() => process.exit(0), 250); });
process.on('SIGINT', () => { for (const controller of controllers.values()) controller.abort(); setTimeout(() => process.exit(0), 250); });
