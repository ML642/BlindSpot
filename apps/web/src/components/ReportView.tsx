import { useEffect, useMemo, useState } from 'react';
import { profiles, type Audit, type Finding, type ProfileId, type Severity } from '@blindspot/shared';
import { artifactUrl } from '../lib/api';
import { buildMarkdown, downloadFile, formatStatus, humanDate, statusClass } from '../lib/format';
import { Icon } from './Icon';

function Metric({ value, label, tone = '' }: { value: string | number; label: string; tone?: string }) {
  return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

type ReviewCheck = NonNullable<Audit['report']>['profiles'][number]['checks'][number];

function countChecks(checks: readonly ReviewCheck[]) {
  return {
    pass: checks.filter(check => check.status === 'pass').length,
    needsReview: checks.filter(check => check.status === 'needs_review').length,
    omitted: checks.filter(check => check.status === 'not_applicable').length,
    blocked: checks.filter(check => check.status === 'blocked').length,
    fail: checks.filter(check => check.status === 'fail').length,
  };
}

function CheckCounts({ checks, compact = false }: { checks: readonly ReviewCheck[]; compact?: boolean }) {
  const counts = countChecks(checks);
  const label = `${counts.pass} passed, ${counts.needsReview} need review, ${counts.omitted} omitted, ${counts.blocked} blocked, ${counts.fail} failed`;
  return <span className={`check-counts ${compact ? 'check-counts-compact' : ''}`} aria-label={label}><span className="count-pass" aria-hidden="true"><Icon name="check" size={12} />{counts.pass} passed</span><span className="count-review" aria-hidden="true">{counts.needsReview} review</span><span className="count-omitted" aria-hidden="true">{counts.omitted} omitted</span><span className="count-blocked" aria-hidden="true">{counts.blocked} blocked</span><span className="count-fail" aria-hidden="true">{counts.fail} failed</span></span>;
}

function FindingCard({ finding, selected, onSelect }: { finding: Finding; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={`finding-card ${selected ? 'is-selected' : ''}`} onClick={onSelect} aria-pressed={selected}><span className={`severity-mark severity-${finding.severity}`} aria-hidden="true" /><span className="finding-card-copy"><span className="finding-card-top"><span className={statusClass(finding.status)}>{formatStatus(finding.status)}</span><span>{finding.method === 'tool' ? 'Tool check' : 'Agent review'}</span></span><strong>{finding.title}</strong><span className="finding-card-meta">{finding.wcag[0]?.id || 'Review'} <span>·</span> {finding.profileIds.length} profile{finding.profileIds.length === 1 ? '' : 's'}</span></span><Icon name="chevron" size={17} /></button>;
}

function Coverage({ audit }: { audit: Audit }) {
  const report = audit.report;
  if (!report) return null;
  const allChecks = [...new Map(report.profiles.flatMap(profile => profile.checks).map(check => [`${check.method}|${check.id}|${check.status}|${check.title}|${check.notes}`, check])).values()];
  return <section className="coverage-panel" aria-labelledby="coverage-title">
    <div className="coverage-panel-head"><div><h2 id="coverage-title">Accessibility review</h2></div><span>{report.profiles.length} playbooks run</span></div>
    <div className="review-totals"><strong>All checks</strong><CheckCounts checks={allChecks} /></div>
    <div className="coverage-grid">{report.profiles.map((profile) => {
      const profileName = profiles.find((item) => item.id === profile.profileId)?.name ?? profile.profileId;
      return <details className="coverage-profile" key={profile.profileId}>
        <summary>
          <span className={`coverage-state state-${profile.status.replace('_', '-')}`}>{profile.status === 'pass' ? <Icon name="check" size={13} /> : <span />}{formatStatus(profile.status)}</span>
          <strong>{profileName}</strong>
          <CheckCounts checks={profile.checks} compact />
          <Icon name="chevron" size={14} />
        </summary>
        <div className="coverage-checks">{profile.checks.map((check) => <div className="coverage-check" key={check.id}>
          <span className={`check-indicator check-${check.status.replace('_', '-')}`} aria-label={formatStatus(check.status)}>{check.status === 'pass' ? <Icon name="check" size={11} /> : check.status === 'fail' ? '!' : check.status === 'not_applicable' ? '-' : '·'}</span>
          <span><strong>{check.title}</strong><small>{check.notes || 'No additional notes.'}</small></span>
          <span className="check-method">{formatStatus(check.status)} / {check.method}</span>
        </div>)}</div>
      </details>;
    })}</div>
  </section>;
}

function ReportDetail({ audit, finding }: { audit: Audit; finding?: Finding }) {
  if (!finding) return <div className="detail-empty"><span className="detail-number">↖</span><h3>Choose a finding to inspect it.</h3><p>Each result includes the affected profile, page state, evidence, and a practical next step.</p></div>;
  const page = audit.pageStates.find((state) => state.id === finding.pageStateId);
  return <article className="report-detail"><div className="detail-head"><div><span className={`severity-label severity-text-${finding.severity}`}>{finding.severity}</span><h2>{finding.title}</h2></div><span className={statusClass(finding.status)}>{formatStatus(finding.status)}</span></div><p className="detail-description">{finding.description}</p><div className="impact-box"><p>Why it matters</p><strong>{finding.impact}</strong></div><div className="detail-section"><h3>Profiles affected</h3><div className="profile-tags">{finding.profileIds.map((profileId) => <span key={profileId}>{profiles.find((profile) => profile.id === profileId)?.name ?? profileId}</span>)}</div></div><div className="detail-section"><h3>Evidence</h3><div className="evidence-list">{finding.evidence.map((evidence) => <div className="evidence-row" key={evidence.id}><span className="evidence-type">{evidence.type}</span><div><strong>{evidence.description}</strong>{evidence.selector && <code>{evidence.selector}</code>}{evidence.value && <span className="evidence-value">{evidence.value}</span>}</div>{evidence.artifactId && <a href={artifactUrl(audit.id, evidence.artifactId)} target="_blank" rel="noreferrer" aria-label={`Open ${evidence.type} evidence`}><Icon name="external" size={15} /></a>}</div>)}</div>{page && <p className="page-reference">Captured on <strong>{page.title || page.url}</strong> · {humanDate(page.capturedAt)}</p>}</div><div className="detail-section"><h3>Reproduce</h3><ol className="repro-list">{finding.reproduction.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}</ol></div><div className="recommendation"><span className="recommendation-label">Suggested next step</span><p>{finding.recommendation}</p></div><div className="wcag-links"><h3>Standards reference</h3>{finding.wcag.map((criterion) => <a href={criterion.url} target="_blank" rel="noreferrer" key={criterion.id}>{criterion.id} {criterion.title} <Icon name="external" size={13} /></a>)}</div></article>;
}

export function ReportView({ audit, onNewAudit }: { audit: Audit; onNewAudit: () => void }) {
  const report = audit.report;
  const [selectedFindingId, setSelectedFindingId] = useState<string | undefined>(report?.findings[0]?.id);
  const [profileFilter, setProfileFilter] = useState<'all' | ProfileId>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'fail' | 'needs_review'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showLimitations, setShowLimitations] = useState(false);
  const findings = report?.findings ?? [];
  const filteredFindings = useMemo(() => findings.filter((finding) => (profileFilter === 'all' || finding.profileIds.includes(profileFilter)) && (severityFilter === 'all' || finding.severity === severityFilter) && (statusFilter === 'all' || finding.status === statusFilter)), [findings, profileFilter, severityFilter, statusFilter]);
  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId);
  const failCount = findings.filter((finding) => finding.status === 'fail').length;
  const reviewCount = findings.filter((finding) => finding.status === 'needs_review').length;
  const profilePassCount = report?.profiles.filter((profile) => profile.status === 'pass').length ?? 0;
  const activeFilters = [profileFilter !== 'all', severityFilter !== 'all', statusFilter !== 'all'].filter(Boolean).length;

  useEffect(() => {
    if (selectedFindingId && filteredFindings.some((finding) => finding.id === selectedFindingId)) return;
    setSelectedFindingId(filteredFindings[0]?.id);
  }, [filteredFindings, selectedFindingId]);

  const clearFilters = () => { setProfileFilter('all'); setSeverityFilter('all'); setStatusFilter('all'); };
  const exportJson = () => downloadFile(`blindspot-${audit.id}.json`, JSON.stringify(audit, null, 2), 'application/json');
  const exportMarkdown = () => downloadFile(`blindspot-${audit.id}.md`, buildMarkdown(audit), 'text/markdown');

  if (!report) return <main className="error-main"><div className="error-mark">!</div><h1>There is no report to show yet.</h1><p>The audit ended with status “{audit.status}”. {audit.error || 'Try the audit again from a new run.'}</p><button className="primary-button button-inline" type="button" onClick={onNewAudit}>Start a new audit <Icon name="arrow" size={18} /></button></main>;

  return <main className="report-main"><div className="report-heading"><div><p className="panel-kicker">Audit report <span className="sample-flag">{audit.demo ? 'Sample' : 'Live'}</span></p><h1>Accessibility report</h1><p className="report-url"><Icon name="external" size={14} /> {audit.request.url} <span>·</span> {humanDate(audit.updatedAt)}</p></div><div className="report-actions"><button className="quiet-button" type="button" onClick={onNewAudit}>New audit</button><div className="export-menu"><button className="quiet-button" type="button" onClick={exportJson}><Icon name="download" size={15} /> JSON</button><button className="quiet-button" type="button" onClick={exportMarkdown}><Icon name="download" size={15} /> Markdown</button></div></div></div><section className="summary-band"><div className="summary-copy"><span className={`scenario-status scenario-${report.scenarioOutcome}`}><span /> Scenario {report.scenarioOutcome}</span><p>{report.summary}</p></div><div className="metrics"><Metric value={failCount} label="findings" tone="metric-alert" /><Metric value={reviewCount} label="needs review" /><Metric value={`${profilePassCount}/${report.profiles.length}`} label="profiles clear" tone="metric-blue" /></div></section><div className="limitations-toggle"><button className="text-button" type="button" onClick={() => setShowLimitations(!showLimitations)}>{showLimitations ? 'Hide limitations' : 'Read limitations'} <Icon name="chevron" size={14} /></button></div>{showLimitations && <div className="limitations-box"><strong>Review boundaries</strong>{report.limitations.map((limitation) => <span key={limitation}>{limitation}</span>)}</div>}<Coverage audit={audit} /><div className="report-layout"><section className="findings-column" aria-labelledby="findings-title"><div className="section-heading"><div><p className="panel-kicker">Prioritised review</p><h2 id="findings-title">Findings <span>{filteredFindings.length}</span></h2></div><button className={`filter-button ${filtersOpen || activeFilters ? 'is-active' : ''}`} type="button" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}><Icon name="filter" size={16} /> Filters {activeFilters > 0 && <b>{activeFilters}</b>}</button></div>{filtersOpen && <div className="filters-panel"><label>Profile<select value={profileFilter} onChange={(event) => setProfileFilter(event.target.value as 'all' | ProfileId)}><option value="all">All profiles</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label><label>Severity<select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as 'all' | Severity)}><option value="all">All severities</option><option value="critical">Critical</option><option value="serious">Serious</option><option value="moderate">Moderate</option><option value="minor">Minor</option></select></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | 'fail' | 'needs_review')}><option value="all">All statuses</option><option value="fail">Failed</option><option value="needs_review">Needs review</option></select></label>{activeFilters > 0 && <button className="clear-filter" type="button" onClick={clearFilters}>Clear</button>}</div>}<div className="finding-list">{filteredFindings.length ? filteredFindings.map((finding) => <FindingCard finding={finding} selected={finding.id === selectedFindingId} onSelect={() => setSelectedFindingId(finding.id)} key={finding.id} />) : <div className="empty-findings"><Icon name="check" size={22} /><h3>No findings match these filters.</h3><button className="text-button" type="button" onClick={clearFilters}>Clear filters</button></div>}</div></section><aside className="detail-column" aria-live="polite"><ReportDetail audit={audit} finding={selectedFinding} /></aside></div><div className="report-disclaimer"><Icon name="spark" size={15} /> Automated checks surface evidence and review prompts. They do not certify a site as fully conformant.</div></main>;
}
