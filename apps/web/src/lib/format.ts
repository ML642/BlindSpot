import type { Audit } from '@blindspot/shared';

export function formatStatus(status: string) {
  return status === 'needs_review' ? 'Needs review' : status.charAt(0).toUpperCase() + status.slice(1);
}

export function statusClass(status: string) {
  return `status status-${status.replace('_', '-')}`;
}

export function humanDate(date: string) {
  try {
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
  } catch {
    return date;
  }
}

export function buildMarkdown(audit: Audit) {
  const report = audit.report;
  if (!report) return `# BlindSpot audit\n\nAudit ${audit.id} has no report yet.`;
  const lines = [
    '# BlindSpot accessibility audit', '',
    `- URL: ${audit.request.url}`,
    `- Scenario: ${audit.request.scenario}`,
    `- Status: ${formatStatus(audit.status)}`,
    `- Run type: ${audit.demo ? 'Sample report (no Gemini call)' : 'Live agent audit'}`,
    `- Audited: ${humanDate(audit.updatedAt)}`,
    '', '## Summary', '', report.summary, '',
    `Scenario outcome: **${report.scenarioOutcome}**`, '',
    '## Findings', '',
  ];
  if (!report.findings.length) lines.push('No findings were returned for the selected profiles.');
  report.findings.forEach((finding) => {
    lines.push(`### ${finding.title}`, '', `**${finding.severity} · ${finding.status}**`, '', finding.description, '', `Impact: ${finding.impact}`, '', `Profiles: ${finding.profileIds.join(', ')}`, '', 'Reproduction:', ...finding.reproduction.map((step, index) => `${index + 1}. ${step}`), '', 'Evidence:', ...finding.evidence.map((evidence) => `- ${evidence.type}: ${evidence.description}${evidence.selector ? ` (${evidence.selector})` : ''}${evidence.value ? ` — ${evidence.value}` : ''}`), '', `Recommendation: ${finding.recommendation}`, '', `WCAG: ${finding.wcag.map((criterion) => `${criterion.id} ${criterion.title}`).join('; ')}`, '');
  });
  lines.push('## Limitations', '', ...report.limitations.map((limitation) => `- ${limitation}`));
  return lines.join('\n');
}

export function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
