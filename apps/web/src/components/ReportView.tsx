import { useState } from 'react';
import { profiles, findingCopy, findingDisposition, type Audit, type Finding, type FindingDisposition, type ProfileId } from '@blindspot/shared';
import { artifactUrl } from '../lib/api';
import { buildMarkdown, downloadFile, formatStatus, humanDate, findingLocation } from '../lib/format';
import { FindingLocation } from './FindingLocation';
import '../report.css';

const priority = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const labels: Record<FindingDisposition, string> = { confirmed: 'Confirmed by a tool', review: 'Check manually', suggestion: 'Good practice', unverified: 'Unverified observation' };

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
  return <details className="report-secondary"><summary>Scope, checks and limitations</summary>
    <div className="report-secondary-body"><p>{report.summary}</p><p>{audit.pageStates.length} captured states · {report.profiles.length} profiles assessed. A profile without findings is not a guarantee of accessibility.</p>
      <h3>Limitations</h3><ul>{[...new Set(report.limitations)].map(item => <li key={item}>{item}</li>)}</ul>
      {report.profiles.map(profile => <details className="report-technical" key={profile.profileId}><summary>{profiles.find(p => p.id === profile.profileId)?.name ?? profile.profileId} — {profile.checks.length} checks</summary>
        <p>{profile.summary}</p>{profile.checks.map(check => <div className="report-evidence" key={check.id}><strong>{check.title}</strong><p>{check.status === 'blocked' ? 'Not checked' : check.status === 'needs_review' ? 'Manual verification needed' : formatStatus(check.status)} · {check.method}</p><p>{check.notes}</p></div>)}
      </details>)}
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
