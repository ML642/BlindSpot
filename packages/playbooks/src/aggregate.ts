import type { Finding, ProfileId } from '@blindspot/shared';
import type { FindingAggregationOptions } from './types.js';

function normalize(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Merge repeated tool/specialist reports while retaining every affected impairment profile. */
export function aggregateFindings(findings: readonly Finding[], options: FindingAggregationOptions = {}): Finding[] {
  const grouped = new Map<string, Finding>();
  for (const finding of findings) {
    const criterion = finding.wcag.map(ref => ref.id).sort().join(',');
    const key = [
      options.preservePageStates === false ? '' : finding.pageStateId,
      criterion,
      normalize(finding.selector),
      normalize(finding.title),
    ].join('|');
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...finding, profileIds: [...finding.profileIds] });
      continue;
    }
    const profileIds = [...new Set<ProfileId>([...current.profileIds, ...finding.profileIds])];
    const evidence = [...current.evidence];
    const evidenceKeys = new Set(evidence.map(item => `${item.type}|${item.selector ?? ''}|${item.description}`));
    for (const item of finding.evidence) {
      const evidenceKey = `${item.type}|${item.selector ?? ''}|${item.description}`;
      if (!evidenceKeys.has(evidenceKey)) { evidence.push(item); evidenceKeys.add(evidenceKey); }
    }
    const reproduction = [...new Set([...current.reproduction, ...finding.reproduction])];
    const severity = severityRank(finding.severity) > severityRank(current.severity) ? finding.severity : current.severity;
    const preferred = finding.method === 'tool' && finding.status === 'fail' ? finding : current;
    grouped.set(key, { ...preferred, profileIds, evidence, reproduction, severity, status: current.status === 'fail' || finding.status === 'fail' ? 'fail' : 'needs_review' });
  }
  return [...grouped.values()];
}

function severityRank(value: Finding['severity']): number {
  return { critical: 4, serious: 3, moderate: 2, minor: 1 }[value];
}
