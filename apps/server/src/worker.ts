import type { AuditEvent, AuditReport, AuditRequest, AuditStatus, PageState } from '@blindspot/shared';
import { BrowserSession, AuditCancelledError, type BrowserLimits, type PageSnapshot } from './browser.js';
import type { ArtifactStore } from './storage.js';
import { runLiveChecks, combinePlaybookResults, type LiveResult } from './playbook-adapter.js';
import { runGeminiAgent } from './gemini-agent.js';
import { runSpecialists } from './specialists.js';
import { isFixtureUrl } from './security.js';

export interface AuditJob { id: string; request: AuditRequest; geminiApiKey?: string; geminiModel: string; fixtureTarget?: string; limits: BrowserLimits; }
export interface WorkerResult { status: AuditStatus; pageStates: PageState[]; report?: AuditReport; error?: string; }
export interface WorkerDependencies { store: ArtifactStore; emit: (event: Omit<AuditEvent, 'id' | 'timestamp'>) => void; signal: AbortSignal; checkpoint?: (result: WorkerResult) => Promise<void>; }

export async function runAuditJob(job: AuditJob, dependencies: WorkerDependencies): Promise<WorkerResult> {
  const { emit, signal, store } = dependencies;
  let session: BrowserSession | undefined;
  const captured: PageSnapshot[] = [];
  const results: LiveResult[] = [];
  const limitations = [
    'Automated checks and Gemini reviews do not establish WCAG conformance.',
    'Real screen readers, switch controls, voice control and caption quality require human testing.',
    'Viewport and text-size probes are not full 200–400% browser-zoom testing.',
    'Only public GET/HEAD/OPTIONS requests are allowed. POST-loaded interfaces, popups and WebSockets may be incomplete.',
  ];
  const report = (summary: string, outcome: AuditReport['scenarioOutcome']): AuditReport => ({ summary, scenarioOutcome: outcome, ...combinePlaybookResults(results, job.request.profileIds, limitations) });
  try {
    emit({ type: 'status', message: 'Opening Chromium and capturing the starting page.' });
    session = await BrowserSession.open({
      startUrl: job.request.url, fixtureTarget: job.fixtureTarget, store, auditId: job.id, signal, emit,
      ...job.limits,
      onCapture: async (page, snapshot, probePage) => {
        captured.push(snapshot);
        try { results.push(await runLiveChecks(page, snapshot, job.request.profileIds, undefined, probePage)); }
        catch { limitations.push(`Deterministic checks could not complete for page state ${snapshot.state.id}.`); emit({ type: 'warning', message: 'Some checkers could not complete for this state.' }); }
        await dependencies.checkpoint?.({ status: 'running', pageStates: captured.map(s => s.state), report: report('Audit in progress. These are the checks collected so far.', 'partial') });
      },
    });
    const navigation = await runGeminiAgent(session, { apiKey: job.geminiApiKey, model: job.geminiModel, scenario: job.request.scenario, startUrl: job.request.url, emit, signal, allowHeuristic: isFixtureUrl(job.request.url, job.fixtureTarget) });
    emit({ type: 'status', message: 'Specialists are reviewing the captured journey.' });
    const specialists = await runSpecialists({ apiKey: job.geminiApiKey, model: job.geminiModel, scenario: job.request.scenario, profileIds: job.request.profileIds, snapshots: captured, store, auditId: job.id, signal, emit });
    results.push(specialists);
    if (signal.aborted) throw new AuditCancelledError();
    const outcome = navigation.outcome;
    const incomplete = specialists.profiles.some(p => p.checks.some(c => c.status === 'blocked'));
    return { status: outcome === 'completed' && !incomplete ? 'completed' : 'partial', pageStates: captured.map(s => s.state), report: report(navigation.summary, outcome) };
  } catch (error) {
    const cancelled = signal.aborted || error instanceof AuditCancelledError;
    const message = cancelled ? 'Audit stopped; captured evidence is preserved.' : 'The browser audit stopped before completion. Captured evidence is preserved.';
    emit({ type: 'warning', message });
    return { status: cancelled ? 'cancelled' : captured.length ? 'partial' : 'failed', pageStates: captured.map(s => s.state), report: report(message, 'partial'), error: message };
  } finally { await session?.close(); }
}
