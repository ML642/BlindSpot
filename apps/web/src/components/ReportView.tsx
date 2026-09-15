import { useEffect, useState } from 'react';
import { profiles, findingCopy, findingDisposition, type Audit, type Finding, type FindingDisposition, type ProfileId } from '@blindspot/shared';
import { artifactUrl } from '../lib/api';
import { buildMarkdown, downloadFile, formatStatus, humanDate, findingLocation } from '../lib/format';
import { FindingLocation } from './FindingLocation';
import { RunTrace } from './RunTrace';
import { loadReviewMarks, reviewKey, reviewRank, updateReviewMark, type ReviewStatus } from '../lib/review-state';
import '../report.css';

const priority = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const labels: Record<FindingDisposition, string> = { confirmed: 'Confirmed by a tool', review: 'Check manually', suggestion: 'Good practice', unverified: 'Unverified observation' };

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
  return <span className={`check-counts ${compact ? 'check-counts-compact' : ''}`} aria-label={label}><span className="count-pass" aria-hidden="true"><span>{String.fromCodePoint(0x2713)}</span>{counts.pass} passed</span><span className="count-review" aria-hidden="true">{counts.needsReview} review</span><span className="count-omitted" aria-hidden="true">{counts.omitted} omitted</span><span className="count-blocked" aria-hidden="true">{counts.blocked} blocked</span><span className="count-fail" aria-hidden="true">{counts.fail} failed</span></span>;
}

function FindingDetail({ audit, finding, reviewStatus, onReview }: { audit: Audit; finding: Finding; reviewStatus: ReviewStatus; onReview: (status: ReviewStatus) => void }) {
  const location = findingLocation(audit, finding);
  const disposition = findingDisposition(finding);
  const copy = findingCopy(finding);
  const foundBy = finding.profileIds.map(id => profiles.find(profile => profile.id === id)?.name ?? id).join(', ');
  return <article className="selected-issue" aria-labelledby="selected-issue-title">
    <header className="selected-issue-header">
      <div className="selected-issue-title">
        <span className={`report-label report-label-${disposition}`}>{labels[disposition]}{disposition === 'confirmed' ? ` · ${finding.severity}` : ''}</span>
        <h2 id="selected-issue-title">{copy.title}</h2>
        <p className="issue-meta">{foundBy && <span>Found by <strong>{foundBy}</strong></span>}<span>{location.page?.title || 'Captured page'}</span></p>
      </div>
      <div className="finding-review-actions" role="group" aria-label="Review status">
        {reviewStatus === 'open' && <button type="button" className="quiet-button" onClick={() => onReview('seen')}>Mark as seen</button>}
        {reviewStatus !== 'resolved' && <button type="button" className="quiet-button" onClick={() => onReview('resolved')}>Mark as resolved</button>}
        {reviewStatus !== 'open' && <button type="button" className="quiet-button" onClick={() => onReview('open')}>Reopen</button>}
      </div>
    </header>
    <div className="report-item-body">
      <div className="finding-guidance">
        {finding.observation && <section className="finding-observation"><h3>What we observed</h3><p>{finding.observation}</p></section>}
        <section className="finding-fix"><h3>How to fix it</h3><p>{copy.recommendation}</p></section>
      </div>
      <FindingLocation audit={audit} finding={finding} />
      <details className="report-technical"><summary>Technical details</summary>
        <div className="technical-links">
          {finding.wcag.map(ref => <a href={ref.url} target="_blank" rel="noreferrer" key={ref.id}>{ref.id} {ref.title}</a>)}
          {location.page?.domArtifactId && <a href={artifactUrl(audit.id, location.page.domArtifactId)} target="_blank" rel="noreferrer">Rendered HTML</a>}
          {location.page?.accessibilityArtifactId && <a href={artifactUrl(audit.id, location.page.accessibilityArtifactId)} target="_blank" rel="noreferrer">Accessibility tree</a>}
          <button type="button" className="quiet-button" onClick={() => downloadFile(`blindspot-finding-${finding.id}.json`, JSON.stringify(finding, null, 2), 'application/json')}>Raw finding JSON</button>
        </div>
      </details>
    </div>
  </article>;
}

function Coverage({ audit }: { audit: Audit }) {
  const report = audit.report!;
  const allChecks = [...new Map(report.profiles.flatMap(profile => profile.checks).map(check => [`${check.method}|${check.id}|${check.status}|${check.title}|${check.notes}`, check])).values()];
  return <details className="report-secondary"><summary>Scope, checks and limitations <span>{allChecks.length} checks</span></summary>
    <div className="report-secondary-body">
      <p>{report.summary}</p><p>{audit.pageStates.length} captured states / {report.profiles.length} profiles assessed. A profile without findings is not a guarantee of accessibility.</p>
      <div className="review-totals"><strong>Accessibility checks</strong><CheckCounts checks={allChecks} /></div>
      <div className="coverage-grid">{report.profiles.map(profile => {
        const profileName = profiles.find(item => item.id === profile.profileId)?.name ?? profile.profileId;
        return <details className="coverage-profile" key={profile.profileId}>
          <summary>
            <span className={`coverage-state state-${profile.status.replace('_', '-')}`}>{profile.status === 'pass' ? <span aria-hidden="true">{String.fromCodePoint(0x2713)}</span> : <span />}{formatStatus(profile.status)}</span>
            <strong>{profileName}</strong>
            <CheckCounts checks={profile.checks} compact />
          </summary>
          <div className="coverage-checks">{profile.checks.map((check, index) => <div className="coverage-check" key={`${check.id}-${index}`}>
            <span className={`check-indicator check-${check.status.replace('_', '-')}`} aria-label={formatStatus(check.status)}>{check.status === 'pass' ? String.fromCodePoint(0x2713) : check.status === 'fail' ? '!' : check.status === 'not_applicable' ? '-' : String.fromCodePoint(0x00b7)}</span>
            <span><strong>{check.title}</strong><small>{check.notes || 'No additional notes.'}</small></span>
            <span className="check-method">{check.status === 'blocked' ? 'Not checked' : check.status === 'needs_review' ? 'Manual verification needed' : formatStatus(check.status)} / {check.method}</span>
          </div>)}</div>
        </details>;
      })}</div>
      <h3>Limitations</h3><ul>{[...new Set(report.limitations)].map(item => <li key={item}>{item}</li>)}</ul>
    </div>
  </details>;
}

function AuditReportView({ audit, onNewAudit }: { audit: Audit; onNewAudit: () => void }) {
  const [profileFilter, setProfileFilter] = useState<'all' | ProfileId>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [category, setCategory] = useState<FindingDisposition>('confirmed');
  const [review, setReview] = useState(() => loadReviewMarks(audit.id));
  const [lastChange, setLastChange] = useState<{ id: string; previous: ReviewStatus; status: ReviewStatus }>();
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === reviewKey(audit.id) || event.key === null) { setReview(loadReviewMarks(audit.id)); setLastChange(undefined); }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [audit.id]);
  const mark = (id: string, status: ReviewStatus, undo = false) => {
    const loaded = loadReviewMarks(audit.id);
    const current = loaded.warning || review.warning ? review.marks : loaded.marks;
    const previous = current[id] ?? 'open';
    const marks = updateReviewMark(current, id, status);
    let warning = '';
    try { localStorage.setItem(reviewKey(audit.id), JSON.stringify(marks)); }
    catch { warning = 'This change is temporary. Browser storage is unavailable. Download JSON to keep your review marks.'; }
    setReview({ marks, warning });
    setSelectedId(id);
    setLastChange(undo ? undefined : { id, previous, status });
  };
  const report = audit.report;
  if (!report) return <main className="error-main"><h1>There is no report to show yet.</h1><p>{audit.error || `Audit status: ${audit.status}.`}</p><button className="quiet-button" onClick={onNewAudit}>New audit</button></main>;
  const all = [...report.findings].sort((a, b) => priority[a.severity] - priority[b.severity]);
  const visible = all.filter(f => profileFilter === 'all' || f.profileIds.includes(profileFilter));
  const categoryNames: Record<FindingDisposition, string> = { confirmed: 'Confirmed', review: 'To verify', suggestion: 'Suggestions', unverified: 'Unverified' };
  const listed = visible.filter(f => findingDisposition(f) === category).sort((a, b) => reviewRank[review.marks[a.id] ?? 'open'] - reviewRank[review.marks[b.id] ?? 'open']);
  const selected = listed.find(f => f.id === selectedId) ?? listed[0];
  const selectFinding = (finding: Finding) => {
    setSelectedId(finding.id);
    if (window.matchMedia('(max-width: 760px)').matches) {
      requestAnimationFrame(() => document.getElementById('issue-detail')?.focus());
    }
  };
  const confirmedTotal = all.filter(f => findingDisposition(f) === 'confirmed').length;
  return <main className="report-main report-calm">
    <header className="report-heading"><div><p className="report-context">{audit.demo ? 'Sample audit' : 'Website audit'} · {humanDate(audit.updatedAt)}</p><h1>Accessibility report</h1><p className="report-site">{audit.request.url}</p></div>
      <div className="report-actions"><button className="quiet-button" onClick={onNewAudit}>New audit</button><div className="export-group" role="group" aria-label="Export"><button className="quiet-button" onClick={() => downloadFile(`blindspot-${audit.id}.json`, JSON.stringify({ ...audit, manualReview: { scope: 'this browser', marks: review.marks } }, null, 2), 'application/json')}>JSON</button><button className="quiet-button" onClick={() => downloadFile(`blindspot-${audit.id}.md`, buildMarkdown(audit, window.location.origin) + '\n\n## Manual review\n\nSaved in this browser. Resolved does not mean retested.\n\n' + report.findings.map(f => `- ${findingCopy(f).title}, ${review.marks[f.id] ?? 'open'}`).join('\n'), 'text/markdown')}>Markdown</button></div></div>
    </header>
    <div className="report-command-bar">
      <div className="result-switcher" role="group" aria-label="Result categories">{(Object.keys(categoryNames) as FindingDisposition[]).map(kind => <button key={kind} type="button" aria-pressed={category === kind} onClick={() => setCategory(kind)}><span className={`issue-dot issue-dot-${kind === 'confirmed' ? 'urgent' : kind}`} aria-hidden="true" />{categoryNames[kind]}<span className="category-count">{visible.filter(f => findingDisposition(f) === kind).length}</span></button>)}</div>
      <span className="run-outcome" data-outcome={report.scenarioOutcome}>{report.scenarioOutcome === 'completed' ? 'Scenario completed' : report.scenarioOutcome === 'blocked' ? 'Scenario blocked' : 'Partial audit'}</span>
    </div>
    <div className="review-feedback" role="status">{lastChange && <><span>{lastChange.status === 'open' ? 'Finding reopened.' : lastChange.status === 'seen' ? 'Finding marked as seen.' : 'Finding marked as resolved.'}</span><button type="button" className="quiet-button" onClick={() => mark(lastChange.id, lastChange.previous, true)}>Undo</button></>}</div>
    {review.warning && <p className="review-warning" role="alert">{review.warning}</p>}
    <div className="issue-workspace">
      <section className="issue-sidebar" aria-label="Findings">
        <div className="issue-sidebar-tools">
          <label className="report-profile-filter">Profile<select value={profileFilter} onChange={e => setProfileFilter(e.target.value as 'all' | ProfileId)}><option value="all">All profiles</option>{profiles.filter(p => audit.request.profileIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>

        </div>
        <p className="issue-list-caption">{categoryNames[category]} <span>{listed.length}</span></p>
        <div className="issue-list">{listed.map(finding => {
          const kind = findingDisposition(finding);
          const tone = kind === 'confirmed' && ['critical', 'serious'].includes(finding.severity) ? 'urgent' : kind;
          const reviewStatus = review.marks[finding.id] ?? 'open';
          return <button key={finding.id} type="button" className="issue-list-row" data-review={reviewStatus} aria-pressed={selected?.id === finding.id} aria-controls="issue-detail" onClick={() => selectFinding(finding)}>
            <span className={`issue-dot issue-dot-${tone}`} aria-hidden="true" />
            <span><strong>{findingCopy(finding).title}</strong><small>{finding.selector || audit.pageStates.find(p => p.id === finding.pageStateId)?.title || 'Captured page'}{reviewStatus !== 'open' ? ` · ${reviewStatus === 'seen' ? 'Seen' : 'Resolved'}` : ''}</small></span>
          </button>;
        })}</div>
        {!listed.length && <p className="report-empty">No results in this category for the selected profile.</p>}
      </section>
      <section id="issue-detail" className="issue-detail-panel" tabIndex={-1} aria-label="Selected finding">
        {selected ? <FindingDetail key={selected.id} audit={audit} finding={selected} reviewStatus={review.marks[selected.id] ?? 'open'} onReview={status => mark(selected.id, status)} /> : <div className="issue-no-selection"><h2>No finding to display</h2><p>Choose another category or profile. An empty list does not mean the site is fully accessible.</p></div>}
      </section>
    </div>
    <details className="report-secondary"><summary>About this audit <span>{confirmedTotal} confirmed barriers</span></summary><div className="report-secondary-body"><p>{audit.request.scenario}</p><p>{report.summary}</p><p>Scenario completion does not establish accessibility. Only captured states were inspected.</p></div></details>
    <Coverage audit={audit} />
    <RunTrace audit={audit} />
    <p className="report-footnote">Automated checks do not certify accessibility. Test important journeys with people who use assistive technology.</p>
  </main>;
}

export function ReportView(props: { audit: Audit; onNewAudit: () => void }) {
  return <AuditReportView key={props.audit.id} {...props} />;
}
