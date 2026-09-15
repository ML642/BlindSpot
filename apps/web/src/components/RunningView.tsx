import type { Audit, AuditEvent } from '@blindspot/shared';
import { artifactUrl } from '../lib/api';
import { humanDate } from '../lib/format';
import { Icon } from './Icon';

function eventGlyph(type: AuditEvent['type']): string {
  switch (type) {
    case 'tool': return '⌁';
    case 'warning':
    case 'error': return '!';
    case 'navigation': return '↗';
    case 'status':
    case 'profile': return '·';
    default: {
      const _never: never = type;
      return _never;
    }
  }
}

export function RunningView({ audit, events, onCancel }: { audit: Audit; events: AuditEvent[]; onCancel: () => void }) {
  const latestPage = audit.pageStates[audit.pageStates.length - 1];
  const progress = audit.progress.totalProfiles ? Math.min(100, Math.round((audit.progress.completedProfiles / audit.progress.totalProfiles) * 100)) : 8;
  return <main className="running-main">
    <div className="running-heading"><div><p className="panel-kicker">Audit in progress</p><h1>Following the journey.</h1><p className="running-url"><Icon name="external" size={14} /> {audit.request.url}</p></div><button className="quiet-button danger-button" type="button" onClick={onCancel}><Icon name="stop" size={15} /> Stop audit</button></div>
    <div className="progress-band"><div className="progress-meta"><span>{audit.progress.phase || 'Preparing browser'}</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><div className="progress-detail">{audit.progress.completedProfiles} of {audit.progress.totalProfiles} profiles reviewed <span>•</span> Evidence is captured as the agent moves</div></div>
    <div className="running-grid">
      <section className="activity-panel" aria-labelledby="activity-title"><div className="section-heading"><div><p className="panel-kicker">Live trace</p><h2 id="activity-title">Agent activity</h2></div><span className="live-indicator"><span />Live</span></div><div className="event-list" aria-live="polite">{events.length ? events.slice(-12).reverse().map((event) => <div className="event-row" key={`${event.id}-${event.timestamp}`}><span className={`event-icon event-${event.type}`} aria-hidden="true">{eventGlyph(event.type)}</span><div><p>{event.message}</p><time>{humanDate(event.timestamp)}</time></div></div>) : <div className="empty-trace"><span className="spinner" />Waiting for the first browser event…</div>}</div></section>
      <section className="capture-panel" aria-labelledby="capture-title"><div className="section-heading"><div><p className="panel-kicker">Captured state</p><h2 id="capture-title">What the agent sees</h2></div>{latestPage && <span className="state-count">{audit.pageStates.length} state{audit.pageStates.length === 1 ? '' : 's'}</span>}</div>{latestPage ? <><div className="capture-frame">{latestPage.screenshotArtifactId ? <img src={artifactUrl(audit.id, latestPage.screenshotArtifactId)} alt={`Screenshot of ${latestPage.title || latestPage.url}`} /> : <div className="capture-placeholder"><Icon name="eye" size={24} /><span>Screenshot is being prepared</span></div>}<span className="capture-label">{latestPage.title || 'Untitled page'}</span></div><p className="capture-description">{latestPage.description}</p></> : <div className="capture-placeholder capture-empty"><Icon name="eye" size={26} /><span>Waiting for the first page state…</span></div>}</section>
    </div>
    <div className="running-footnote"><Icon name="spark" size={15} /> Findings are reviewed against a profile-specific playbook after the journey completes.</div>
  </main>;
}
