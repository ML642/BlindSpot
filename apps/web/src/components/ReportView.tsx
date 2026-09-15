import { useState } from 'react';
import { profiles, findingCopy, findingDisposition, type Audit, type Finding, type FindingDisposition, type ProfileId } from '@blindspot/shared';
import { artifactUrl } from '../lib/api';
import { buildMarkdown, downloadFile, formatStatus, humanDate, findingLocation } from '../lib/format';
import { FindingLocation } from './FindingLocation';
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

function FindingRow({ audit, finding }: { audit: Audit; finding: Finding }) {
  const [open, setOpen] = useState(false);
  const location = findingLocation(audit, finding);
  const disposition = findingDisposition(finding);
  const copy = findingCopy(finding);
  return <details className="report-item" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>
      <span className="report-item-heading"><strong>{copy.title}</strong><span className="report-item-page">{location.page?.title || location.page?.url || 'Page location unavailable'}</span></span>
      <span className={`report-label report-label-${disposition}`}>{labels[disposition]}</span>
    </summary>
    {open && <div className="report-item-body">
      <p>{finding.description}</p>
      {finding.observation && <p><strong>Observed:</strong> {finding.observation}</p>}
      <h3>What to do</h3><p>{copy.recommendation}</p>
      <h3>Why it matters</h3><p>{copy.impact}</p>
      <FindingLocation audit={audit} finding={finding} />
      <details className="report-technical"><summary>Evidence and technical details</summary>
        <p>Original finding: {finding.title}</p><p>{finding.recommendation}</p>
        <p>Reported impact: {finding.severity}. {labels[disposition]} — impact does not indicate certainty.</p>
        <p>Affected profiles: {finding.profileIds.map(id => profiles.find(p => p.id === id)?.name ?? id).join(', ')}.</p>
        <h4>Evidence</h4>
        {finding.evidence.map(evidence => <div key={evidence.id} className="report-evidence"><p>{evidence.description}</p>{evidence.selector && <code>{evidence.selector}</code>}{evidence.value && <p>{evidence.value}</p>}{evidence.artifactId && <a href={artifactUrl(audit.id, evidence.artifactId)} target="_blank" rel="noreferrer">Open {evidence.type} evidence</a>}</div>)}
        <h4>Reproduce</h4><ol>{finding.reproduction.map((step, i) => <li key={i}>{step}</li>)}</ol>
        <h4>Standards reference</h4>{finding.wcag.map(ref => <p key={ref.id}><a href={ref.url} target="_blank" rel="noreferrer">{ref.id} {ref.title}</a></p>)}
      </details>
    </div>}
  </details>;
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

export function ReportView({ audit, onNewAudit }: { audit: Audit; onNewAudit: () => void }) {
  const [profileFilter, setProfileFilter] = useState<'all' | ProfileId>('all');
  const report = audit.report;
  if (!report) return <main className="error-main"><h1>There is no report to show yet.</h1><p>{audit.error || `Audit status: ${audit.status}.`}</p><button className="quiet-button" onClick={onNewAudit}>New audit</button></main>;
  const all = [...report.findings].sort((a, b) => priority[a.severity] - priority[b.severity]);
  const visible = all.filter(f => profileFilter === 'all' || f.profileIds.includes(profileFilter));
  const group = (kind: FindingDisposition) => visible.filter(f => findingDisposition(f) === kind);
  const confirmed = group('confirmed');
  const review = group('review');
  const suggestions = group('suggestion');
  const unverified = group('unverified');
  const confirmedTotal = all.filter(f => findingDisposition(f) === 'confirmed').length;
  return <main className="report-main report-calm">
    <header className="report-heading"><div><p className="report-context">{audit.demo ? 'Sample audit' : 'Website audit'} · {humanDate(audit.updatedAt)}</p><h1>Accessibility report</h1><p className="report-site">{audit.request.url}</p></div>
      <div className="report-actions"><button className="quiet-button" onClick={onNewAudit}>New audit</button><button className="quiet-button" onClick={() => downloadFile(`blindspot-${audit.id}.json`, JSON.stringify(audit, null, 2), 'application/json')}>JSON</button><button className="quiet-button" onClick={() => downloadFile(`blindspot-${audit.id}.md`, buildMarkdown(audit, window.location.origin), 'text/markdown')}>Markdown</button></div>
    </header>
    <section className="report-overview" aria-label="Audit outcome"><h2>{confirmedTotal ? `${confirmedTotal} confirmed ${confirmedTotal === 1 ? 'barrier' : 'barriers'} to address` : 'No confirmed barriers in the captured states'}</h2><p>{report.scenarioOutcome === 'completed' ? 'The agent completed the scenario. This does not mean everyone can complete it.' : report.scenarioOutcome === 'blocked' ? 'The agent could not complete the scenario. Results cover only the states it could inspect.' : 'The scenario was only partly inspected. Some steps remain unchecked.'}</p><details><summary>Scenario and audit summary</summary><p>{audit.request.scenario}</p><p>{report.summary}</p></details></section>
    <section className="report-primary" aria-labelledby="fix-title"><div className="report-section-heading"><div><h2 id="fix-title">What to fix</h2><p>Confirmed tool findings, highest reported impact first.</p></div><label className="report-profile-filter">Profile<select value={profileFilter} onChange={e => setProfileFilter(e.target.value as 'all' | ProfileId)}><option value="all">All profiles</option>{profiles.filter(p => audit.request.profileIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
      {confirmed.length ? confirmed.map(f => <FindingRow key={f.id} audit={audit} finding={f} />) : <p className="report-empty">{profileFilter !== 'all' ? 'No confirmed barriers match this profile.' : 'No confirmed tool findings. Review the checks below; this is not a conformance result.'}</p>}
    </section>
    <details className="report-secondary"><summary>Verify manually <span>{review.length}</span></summary><div className="report-secondary-body"><p>Possible barriers supported by a recorded observation. Verify the impact before treating them as failures.</p>{review.map(f => <FindingRow key={f.id} audit={audit} finding={f} />)}{!review.length && <p>No observed candidates for this selection.</p>}</div></details>
    <details className="report-secondary"><summary>Good-practice suggestions <span>{suggestions.length}</span></summary><div className="report-secondary-body"><p>Recommendations, not confirmed violations. They do not add to the barrier count.</p>{suggestions.map(f => <FindingRow key={f.id} audit={audit} finding={f} />)}{!suggestions.length && <p>No suggestions for this selection.</p>}</div></details>
    {unverified.length > 0 && <details className="report-secondary"><summary>Unverified observations <span>{unverified.length}</span></summary><div className="report-secondary-body"><p>These observations lack a specific recorded condition or supporting evidence. They are not confirmed failures or necessarily optional improvements; their impact still needs verification.</p>{unverified.map(f => <FindingRow key={f.id} audit={audit} finding={f} />)}</div></details>}
    <Coverage audit={audit} />
    <p className="report-footnote">Automated checks do not certify accessibility. Test important journeys with people who use assistive technology.</p>
  </main>;
}
