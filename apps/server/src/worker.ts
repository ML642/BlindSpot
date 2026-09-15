import type { AuditEvent, AuditReport, AuditRequest, AuditStatus, InteractionMode, JourneySummary, PageState } from '@blindspot/shared';
import { journeyModes, profilesForMode, renderingsFor } from '@blindspot/playbooks';
import { BrowserHost, BrowserSession, AuditCancelledError, type BrowserLimits, type PageSnapshot } from './browser.js';
import type { ArtifactStore } from './storage.js';
import { runLiveChecks, combinePlaybookResults, type LiveResult } from './playbook-adapter.js';
import { runJourney, JOURNEY_LABELS } from './journey.js';
import { runSpecialists } from './specialists.js';
import { isFixtureUrl } from './security.js';

export interface AuditJob { id: string; request: AuditRequest; geminiApiKey?: string; geminiModel: string; fixtureTarget?: string; limits: BrowserLimits; maxSpecialists?: number; }
export interface WorkerResult { status: AuditStatus; pageStates: PageState[]; report?: AuditReport; error?: string; }
export interface WorkerDependencies { store: ArtifactStore; emit: (event: Omit<AuditEvent, 'id' | 'timestamp'>) => void; signal: AbortSignal; checkpoint?: (result: WorkerResult) => Promise<void>; }

/**
 * One journey per interaction mode, all in the same Chromium. Every capture stores
 * the full evidence; each specialist later receives only its perspective's channels.
 */
export async function runAuditJob(job: AuditJob, dependencies: WorkerDependencies): Promise<WorkerResult> {
  const { emit, signal, store } = dependencies;
  const captured: PageSnapshot[] = [];
  const results: LiveResult[] = [];
  const journeys: JourneySummary[] = [];
  const limitations = [
    'Automated checks and Gemini reviews do not establish WCAG conformance.',
    'The screen-reader journey uses a virtual screen reader that follows the ARIA specification; NVDA, JAWS and VoiceOver behave differently and require human testing.',
    'Viewport, text-size and vision-deficiency renderings approximate assistive settings; they are not browser zoom or a real user.',
    'Only public GET/HEAD/OPTIONS requests are allowed. POST-loaded interfaces, popups and WebSockets may be incomplete.',
  ];
  const report = (summary: string, outcome: AuditReport['scenarioOutcome']): AuditReport => ({ summary, scenarioOutcome: outcome, ...combinePlaybookResults(results, job.request.profileIds, limitations), journeys: [...journeys] });
  const pageStates = () => captured.map(snapshot => snapshot.state);
  let host: BrowserHost | undefined;
  try {
    const modes = journeyModes(job.request.profileIds);
    emit({ type: 'status', message: `Opening Chromium for ${modes.length} journey${modes.length === 1 ? '' : 's'}: ${modes.map(mode => JOURNEY_LABELS[mode]).join(', ')}.` });
    host = await BrowserHost.launch({ startUrl: job.request.url, fixtureTarget: job.fixtureTarget, emit });
    const checkpoint = () => dependencies.checkpoint?.({ status: 'running', pageStates: pageStates(), report: report('Audit in progress. These are the checks collected so far.', 'partial') });
    const runMode = async (mode: InteractionMode) => {
      const profileIds = profilesForMode(job.request.profileIds, mode);
      emit({ type: 'status', journey: mode, message: `${JOURNEY_LABELS[mode]} journey: opening the starting page.` });
      let session: BrowserSession | undefined;
      try {
        session = await host!.openSession({
          mode, renderings: renderingsFor(profileIds), store, auditId: job.id, signal, emit, ...job.limits,
          onCapture: async (page, snapshot, probePage) => {
            captured.push(snapshot);
            try {
              results.push(await runLiveChecks(page, snapshot, profileIds, probePage, async (probes) => {
                if (mode !== 'keyboard' || !probes.keyboard.trace.length) return;
                snapshot.focusTrace = probes.keyboard.trace;
                const artifact = await store.put(job.id, `${mode}-page-${captured.length}.focus.json`, JSON.stringify(probes.keyboard.trace, null, 1), 'application/json');
                snapshot.state.focusTraceArtifactId = artifact.id;
              }));
            } catch {
              limitations.push(`Deterministic checks could not complete for page state ${snapshot.state.id}.`);
              emit({ type: 'warning', journey: mode, message: 'Some checkers could not complete for this state.', pageStateId: snapshot.state.id });
            }
            await checkpoint();
          },
        });
        journeys.push(await runJourney(session, { mode, profileIds, apiKey: job.geminiApiKey, model: job.geminiModel, scenario: job.request.scenario, startUrl: job.request.url, emit, signal, allowHeuristic: isFixtureUrl(job.request.url, job.fixtureTarget) }));
      } catch (error) {
        if (error instanceof AuditCancelledError || signal.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        journeys.push({ mode, profileIds, outcome: 'blocked', summary: `${JOURNEY_LABELS[mode]} journey could not run: ${message}`, usedGemini: false, steps: [] });
        emit({ type: 'warning', journey: mode, message: `${JOURNEY_LABELS[mode]} journey stopped: ${message}` });
      } finally {
        await session?.close();
      }
      await checkpoint();
    };
    await Promise.all(modes.map(runMode));
    if (signal.aborted) throw new AuditCancelledError();
    emit({ type: 'status', message: 'Specialists are reviewing the captured journeys.' });
    const specialists = await runSpecialists({ apiKey: job.geminiApiKey, model: job.geminiModel, scenario: job.request.scenario, profileIds: job.request.profileIds, snapshots: captured, journeys, toolFindings: results.flatMap(result => result.findings), store, auditId: job.id, signal, emit, maxSpecialists: job.maxSpecialists });
    results.push(specialists);
    if (signal.aborted) throw new AuditCancelledError();
    const outcome: AuditReport['scenarioOutcome'] = journeys.every(journey => journey.outcome === 'completed') ? 'completed' : journeys.some(journey => journey.outcome === 'blocked') ? 'blocked' : 'partial';
    const incomplete = specialists.profiles.some(profile => profile.checks.some(check => check.status === 'blocked'));
    const summary = journeys.map(journey => `${JOURNEY_LABELS[journey.mode]}: ${journey.summary}`).join('\n');

    return { status: outcome === 'completed' && !incomplete ? 'completed' : 'partial', pageStates: pageStates(), report: report(summary, outcome) };
  } catch (error) {
    const cancelled = signal.aborted || error instanceof AuditCancelledError;
    const message = cancelled ? 'Audit stopped; captured evidence is preserved.' : 'The browser audit stopped before completion. Captured evidence is preserved.';
    emit({ type: 'warning', message });

    return { status: cancelled ? 'cancelled' : captured.length ? 'partial' : 'failed', pageStates: pageStates(), report: report(message, 'partial'), error: message };
  } finally {
    await host?.close();
  }
}
