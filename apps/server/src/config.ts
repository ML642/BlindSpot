import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
if (existsSync(path.join(projectRoot, '.env'))) loadEnvFile(path.join(projectRoot, '.env'));

export type ExecutionMode = 'local' | 'gcp';

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  webDistDir: string;
  geminiApiKey?: string;
  geminiModel: string;
  executionMode: ExecutionMode;
  gcpProject?: string;
  gcpRegion?: string;
  gcpJobName?: string;
  gcsBucket?: string;
  fixtureTarget?: string;
  maxAuditMinutes: number;
  maxActions: number;
  maxPageStates: number;
  maxSpecialists: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = projectRoot;
  const executionMode = env.BLINDSPOT_EXECUTION_MODE === 'gcp' ? 'gcp' : 'local';
  return {
    port: positiveInt(env.PORT, 3001),
    host: env.HOST ?? '127.0.0.1',
    dataDir: path.resolve(env.BLINDSPOT_DATA_DIR ?? path.join(root, '.data')),
    webDistDir: path.resolve(env.BLINDSPOT_WEB_DIST ?? path.join(root, 'apps', 'web', 'dist')),
    geminiApiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? 'gemini-3.8-flash',
    executionMode,
    gcpProject: env.GCP_PROJECT ?? env.GOOGLE_CLOUD_PROJECT,
    gcpRegion: env.GCP_REGION ?? 'europe-central2',
    gcpJobName: env.GCP_JOB_NAME,
    gcsBucket: env.GCS_BUCKET,
    fixtureTarget: env.BLINDSPOT_DEMO_TARGET,
    maxAuditMinutes: positiveInt(env.BLINDSPOT_MAX_AUDIT_MINUTES, 10),
    maxActions: positiveInt(env.BLINDSPOT_MAX_ACTIONS, 30),
    maxPageStates: positiveInt(env.BLINDSPOT_MAX_PAGE_STATES, 5),
    maxSpecialists: Math.min(3, positiveInt(env.BLINDSPOT_MAX_SPECIALISTS, 3)),
  };
}
