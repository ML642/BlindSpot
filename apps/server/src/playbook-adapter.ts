import type { Finding, PlaybookResult, ProfileId, Evidence, TestStatus } from '@blindspot/shared';
import { profiles } from '@blindspot/shared';
import type { Page } from 'playwright';
import type { PageSnapshot } from './browser.js';
import { runAutomatedChecks, aggregateFindings } from '@blindspot/playbooks';

export interface PlaybookOutput { profiles: PlaybookResult[]; findings: Finding[]; limitations: string[]; evidence?: Evidence[]; }
export type LiveResult = { findings: Finding[]; profiles: PlaybookResult[]; evidence?: Evidence[]; limitations?: string[] };

export async function runLiveChecks(page: Page, snapshot: PageSnapshot, requestedProfiles: ProfileId[], addEvidence?: (evidence: Omit<Evidence, 'id'> & { id?: string }) => Evidence, probePage?: Page): Promise<LiveResult> {
  const context = { page, probePage, skipInteractionProbes: !probePage, pageState: snapshot.state, axeResults: snapshot.axe.error ? undefined : { violations: snapshot.axe.violations, passes: snapshot.axe.passedRules }, addEvidence };
  const result = await runAutomatedChecks(context, requestedProfiles);
  if (snapshot.axe.error || !probePage) {
    for (const profile of result.profiles) profile.checks.push({ id: `${snapshot.state.id}-unavailable-checks`, title: snapshot.axe.error ? 'axe execution' : 'Isolated interaction replay', status: 'blocked', method: 'tool', evidenceIds: [], notes: snapshot.axe.error ?? 'The state could not be replayed exactly; interaction probes were not run.' });
  }
  return result;
}

function statusRank(status: TestStatus): number { return { fail: 5, blocked: 4, needs_review: 3, pass: 2, not_applicable: 1 }[status]; }

function normalizeCheckText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function mergeRepeatedChecks(items: readonly PlaybookResult['checks'][number][]): PlaybookResult['checks'] {
  const grouped = new Map<string, PlaybookResult['checks'][number]>();
  for (const item of items) {
    const key = [item.method, normalizeCheckText(item.title), normalizeCheckText(item.notes)].join('|');
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...item, evidenceIds: [...item.evidenceIds] });
      continue;
    }
    const strongest = statusRank(item.status) > statusRank(current.status) ? item : current;
    grouped.set(key, {
      ...strongest,
      id: current.id,
      evidenceIds: [...new Set([...current.evidenceIds, ...item.evidenceIds])],
    });
  }
  return [...grouped.values()];
}

export function combinePlaybookResults(results: readonly LiveResult[], requestedProfiles: ProfileId[], extraLimitations: string[] = []): PlaybookOutput {
  const findings = new Map<string, Finding>();
  const checks = new Map<ProfileId, PlaybookResult['checks']>();
  const limitations = new Set(extraLimitations);
  for (const id of requestedProfiles) checks.set(id, []);
  for (const result of results) {
    for (const finding of result.findings) findings.set(finding.id, finding);
    for (const limitation of result.limitations ?? []) limitations.add(limitation);
    for (const profile of result.profiles) {
      if (!checks.has(profile.profileId)) continue;
      checks.get(profile.profileId)!.push(...profile.checks);
    }
  }
  const outputProfiles: PlaybookResult[] = requestedProfiles.map((profileId) => {
    const profile = profiles.find((item) => item.id === profileId);
    const mergedChecks = mergeRepeatedChecks(checks.get(profileId) ?? []);
    const hasSpecialistChecks = mergedChecks.some(item => item.method === 'gemini' && item.id.startsWith('specialist-') && item.id !== 'specialist-review');
    const profileChecks = hasSpecialistChecks ? mergedChecks.filter(item => item.id !== 'specialist-review') : mergedChecks;
    const status = profileChecks.reduce<TestStatus>((current, item) => statusRank(item.status) > statusRank(current) ? item.status : current, profileChecks.length ? 'not_applicable' : 'needs_review');
    return { profileId, status, summary: status === 'fail' ? 'One or more automated checks found issues.' : status === 'needs_review' ? 'Automated checks require specialist or manual review.' : status === 'pass' ? 'Automated checks found no failures.' : status === 'blocked' ? 'One or more checks could not run; review the limitations.' : `No applicable checks ran for ${profile?.name ?? profileId}.`, checks: profileChecks.length ? profileChecks : [{ id: `${profileId}-specialist-review`, title: 'Scenario and assistive technology review', status: 'needs_review', method: 'gemini', evidenceIds: [], notes: 'Static browser checks cannot fully verify this impairment scenario.' }] };
  });
  return { profiles: outputProfiles, findings: aggregateFindings([...findings.values()]), limitations: [...limitations], evidence: [...new Map(results.flatMap(result => [...(result.evidence ?? []), ...result.findings.flatMap(f => f.evidence)]).map(e => [e.id, e])).values()] };
}
