import { useState } from 'react';
import { profiles, findingCopy, findingDisposition, type Audit, type Finding, type FindingDisposition, type ProfileId } from '@blindspot/shared';
import { artifactUrl } from '../lib/api';
import { buildMarkdown, downloadFile, formatStatus, humanDate, findingLocation } from '../lib/format';
import { FindingLocation } from './FindingLocation';
import { RunTrace } from './RunTrace';
import '../report.css';
import '../issue-workspace.css';

const priority = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const labels: Record<FindingDisposition, string> = { confirmed: 'Confirmed by a tool', review: 'Check manually', suggestion: 'Good practice', unverified: 'Unverified observation' };

function FindingDetail({ audit, finding }: { audit: Audit; finding: Finding }) {
  const location = findingLocation(audit, finding);
  const disposition = findingDisposition(finding);
  const copy = findingCopy(finding);
  return <article className="selected-issue" aria-labelledby="selected-issue-title">
    <header className="selected-issue-header">
      <div><p className="issue-eyebrow">{location.page?.title || 'Captured page'}</p><h2 id="selected-issue-title">{copy.title}</h2></div>
      <span className={`report-label report-label-${disposition}`}>{labels[disposition]}</span>
    </header>
    <div className="report-item-body">
      <FindingLocation audit={audit} finding={finding}>
        {finding.observation && <section className="finding-observation"><h3>What we observed</h3><p>{finding.observation}</p></section>}
        <section className="finding-fix"><h3>How to fix it</h3><p>{copy.recommendation}</p></section>
      </FindingLocation>
      <details className="report-technical"><summary>Evidence and technical details</summary>
        <p>{copy.impact}</p><p>Original finding: {finding.title}</p><p>{finding.description}</p><p>{finding.recommendation}</p>
        <p>Reported impact: {finding.severity}. {labels[disposition]} — impact does not indicate certainty.</p>
        <p>Affected profiles: {finding.profileIds.map(id => profiles.find(p => p.id === id)?.name ?? id).join(', ')}.</p>
        <h4>Evidence</h4>
        {finding.evidence.map(evidence => <div key={evidence.id} className="report-evidence"><p>{evidence.description}</p>{evidence.selector && <code>{evidence.selector}</code>}{evidence.value && <p>{evidence.value}</p>}{evidence.artifactId && <a href={artifactUrl(audit.id, evidence.artifactId)} target="_blank" rel="noreferrer">Open {evidence.type} evidence</a>}</div>)}
        <h4>Reproduce</h4><ol>{finding.reproduction.map((step, i) => <li key={i}>{step}</li>)}</ol>
        <h4>Standards reference</h4>{finding.wcag.map(ref => <p key={ref.id}><a href={ref.url} target="_blank" rel="noreferrer">{ref.id} {ref.title}</a></p>)}
      </details>
    </div>
  </article>;
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
  const [selectedId, setSelectedId] = useState<string>();
  const [category, setCategory] = useState<FindingDisposition>('confirmed');
  const report = audit.report;
  if (!report) return <main className="error-main"><h1>There is no report to show yet.</h1><p>{audit.error || `Audit status: ${audit.status}.`}</p><button className="quiet-button" onClick={onNewAudit}>New audit</button></main>;
  const all = [...report.findings].sort((a, b) => priority[a.severity] - priority[b.severity]);
  const visible = all.filter(f => profileFilter === 'all' || f.profileIds.includes(profileFilter));
  const categoryNames: Record<FindingDisposition, string> = { confirmed: 'Confirmed', review: 'To verify', suggestion: 'Suggestions', unverified: 'Unverified' };
  const listed = visible.filter(f => findingDisposition(f) === category);
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
      <div className="report-actions"><button className="quiet-button" onClick={onNewAudit}>New audit</button><button className="quiet-button" onClick={() => downloadFile(`blindspot-${audit.id}.json`, JSON.stringify(audit, null, 2), 'application/json')}>JSON</button><button className="quiet-button" onClick={() => downloadFile(`blindspot-${audit.id}.md`, buildMarkdown(audit, window.location.origin), 'text/markdown')}>Markdown</button></div>
    </header>
    <section className="report-overview" aria-label="Audit outcome"><h2>{confirmedTotal ? `${confirmedTotal} confirmed ${confirmedTotal === 1 ? 'barrier' : 'barriers'} to address` : 'No confirmed barriers in the captured states'}</h2><p>{report.scenarioOutcome === 'completed' ? 'The agent completed the scenario. This does not mean everyone can complete it.' : report.scenarioOutcome === 'blocked' ? 'The agent could not complete the scenario. Results cover only the states it could inspect.' : 'The scenario was only partly inspected. Some steps remain unchecked.'}</p><details><summary>Scenario and audit summary</summary><p>{audit.request.scenario}</p><p>{report.summary}</p></details></section>
    <div className="issue-workspace">
      <section className="issue-sidebar" aria-label="Findings">
        <div className="issue-sidebar-tools">
          <label className="report-profile-filter">Profile<select value={profileFilter} onChange={e => setProfileFilter(e.target.value as 'all' | ProfileId)}><option value="all">All profiles</option>{profiles.filter(p => audit.request.profileIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="report-profile-filter">Results<select value={category} onChange={e => setCategory(e.target.value as FindingDisposition)}>{(Object.keys(categoryNames) as FindingDisposition[]).map(kind => <option key={kind} value={kind}>{categoryNames[kind]} · {visible.filter(f => findingDisposition(f) === kind).length}</option>)}</select></label>
        </div>
        <p className="issue-list-caption">{listed.length} results · highest impact first</p>
        <div className="issue-list">{listed.map(finding => {
          const kind = findingDisposition(finding);
          const tone = kind === 'confirmed' && ['critical', 'serious'].includes(finding.severity) ? 'urgent' : kind;
          return <button key={finding.id} type="button" className="issue-list-row" aria-pressed={selected?.id === finding.id} aria-controls="issue-detail" onClick={() => selectFinding(finding)}>
            <span className={`issue-dot issue-dot-${tone}`} aria-hidden="true" />
            <span><strong>{findingCopy(finding).title}</strong><small>{labels[kind]}{kind === 'confirmed' ? ` · ${finding.severity}` : ''}</small><small>{finding.selector || audit.pageStates.find(p => p.id === finding.pageStateId)?.title || 'Captured page'}</small></span>
          </button>;
        })}</div>
        {!listed.length && <p className="report-empty">No results in this category for the selected profile.</p>}
      </section>
      <section id="issue-detail" className="issue-detail-panel" tabIndex={-1} aria-label="Selected finding">
        {selected ? <FindingDetail key={selected.id} audit={audit} finding={selected} /> : <div className="issue-no-selection"><h2>No finding to display</h2><p>Choose another category or profile. An empty list does not mean the site is fully accessible.</p></div>}
      </section>
    </div>
    <Coverage audit={audit} />
    <RunTrace audit={audit} />
    <p className="report-footnote">Automated checks do not certify accessibility. Test important journeys with people who use assistive technology.</p>
  </main>;
}
