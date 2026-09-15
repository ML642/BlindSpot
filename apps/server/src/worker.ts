import { randomUUID } from 'node:crypto';
import type { AuditEvent, AuditReport, AuditRequest, AuditStatus, Finding, PageState, ProfileId } from '@blindspot/shared';
import { BrowserSession, AuditCancelledError, AuditLimitError, type BrowserLimits, type PageSnapshot } from './browser.js';
import type { ArtifactStore } from './storage.js';
import { diagnosticsEvent, runLiveChecks, combinePlaybookResults, unavailablePlaybooks, type PlaybookOutput, type LiveResult } from './playbook-adapter.js';
import { runGeminiAgent } from './gemini-agent.js';

export interface AuditJob { id: string; request: AuditRequest; geminiApiKey?: string; geminiModel: string; fixtureTarget?: string; limits: BrowserLimits; }
export interface WorkerResult { status: AuditStatus; pageStates: PageState[]; report?: AuditReport; error?: string; }

export interface WorkerDependencies { store: ArtifactStore; emit: (event: Omit<AuditEvent, 'id' | 'timestamp'>) => void; signal: AbortSignal; }

function reportFor(request: AuditRequest, snapshots: readonly PageSnapshot[], outputs: readonly LiveResult[], agentSummary: string, blocked: boolean, packageMissing: string | undefined): AuditReport {
  const limitations = new Set<string>([
    'Automated checks are a triage aid and do not establish WCAG conformance.',
    'Screen readers, switch controls, voice control, caption accuracy and human content review require a person.',
    'Browser zoom at 200–400% and real assistive technology are not fully emulated by this run.',
  ]);
  if (packageMissing) limitations.add(packageMissing);
  for (const output of outputs) for (const limitation of output.limitations ?? []) limitations.add(limitation);
  const combined = outputs.length ? combinePlaybookResults(outputs, request.profileIds, [...limitations]) : unavailablePlaybooks(request.profileIds, packageMissing ?? 'No deterministic playbook result was produced.');
  const findings = combined.findings;
  const scenarioOutcome = blocked ? 'blocked' : snapshots.length > 1 ? 'completed' : 'partial';
  return {
    summary: `${agentSummary} ${findings.length ? `${findings.length} finding${findings.length === 1 ? '' : 's'} require attention.` : 'No automated finding was produced; review the evidence and limitations.'}`,
    scenarioOutcome,
    findings,
    profiles: combined.profiles,
    limitations: combined.limitations,
  };
}

export async function runAuditJob(job: AuditJob, dependencies: WorkerDependencies): Promise<WorkerResult> {
  const { emit, signal, store } = dependencies;
  let session: BrowserSession | undefined;
  const liveResults: LiveResult[] = [];
  let packageMissing: string | undefined;
  let agentSummary = 'The navigation agent did not complete.';
  let blocked = false;
  emit({ type: 'status', message: 'Launching a sandboxed headless browser.' });
  emit(diagnosticsEvent(job.request.profileIds));
  try {
    session = await BrowserSession.open({
      startUrl: job.request.url, fixtureTarget: job.fixtureTarget, store, auditId: job.id, signal,
      maxActions: job.limits.maxActions, maxPageStates: job.limits.maxPageStates, timeoutMs: job.limits.timeoutMs,
      emit,
      onCapture: async (page, snapshot) => {
        try {
          const result = await runLiveChecks(page, snapshot, job.request.profileIds, (evidence) => ({ ...evidence, id: evidence.id ?? randomUUID() }));
          if (result) {
            liveResults.push(result);
            emit({ type: 'profile', message: `Deterministic checks completed for page state ${snapshot.state.id}.`, pageStateId: snapshot.state.id });
          } else packageMissing = 'The accessibility checker package was unavailable; specialist review is required.';
        } catch (error) {
          emit({ type: 'warning', message: `Deterministic checkers failed for ${snapshot.state.id}: ${error instanceof Error ? error.message : String(error)}`, pageStateId: snapshot.state.id });
        }
      },
    });
    const agent = await runGeminiAgent(session, { apiKey: job.geminiApiKey, model: job.geminiModel, scenario: job.request.scenario, startUrl: job.request.url, emit, signal });
    agentSummary = agent.summary;
    blocked = agent.blocked;
    if (!session.snapshots.length) await session.capture('Final page state');
    const report = reportFor(job.request, session.snapshots, liveResults, agentSummary, blocked, packageMissing);
    const status: AuditStatus = blocked ? 'partial' : 'completed';
    emit({ type: 'status', message: status === 'completed' ? 'Audit completed.' : 'Audit completed with a safety boundary or blocked step.' });
    return { status, pageStates: session.snapshots.map((snapshot) => snapshot.state), report };
  } catch (error) {
    const cancelled = error instanceof AuditCancelledError || signal.aborted;
    const limited = error instanceof AuditLimitError;
    const message = cancelled ? 'Audit cancelled; the captured evidence is preserved.' : error instanceof Error ? error.message : String(error);
    emit({ type: cancelled ? 'warning' : 'error', message });
    const snapshots = session?.snapshots ?? [];
    const report = reportFor(job.request, snapshots, liveResults, message, true, packageMissing);
    return { status: cancelled ? 'cancelled' : snapshots.length ? 'partial' : 'failed', pageStates: snapshots.map((snapshot) => snapshot.state), report, error: limited ? `Audit limit reached: ${message}` : message };
  } finally {
    await session?.close();
  }
}
