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

function readableEventMessage(raw: string): string {
  const message = raw.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '');
  if (!/locator\.|getby|call log:|timeout \d+ms exceeded/i.test(message)) return message;
  if (/element is not visible/i.test(message)) return 'Could not activate the requested control because it is not visible.';
  if (/waiting for|getbytext|locator\.elementhandle/i.test(message)) return 'Could not find the requested control on this page.';
  if (/timeout|timed out/i.test(message)) return 'The requested browser action did not respond in time.';
  return 'The requested browser action could not be completed.';
}

function visibleEvents(events: AuditEvent[]): AuditEvent[] {
  const hasSpecialistSummary = events.some(event => /^Specialists are reviewing the captured journey\.?$/i.test(event.message));
  const seen = new Set<string>();
  return [...events].reverse().filter(event => {
    if (hasSpecialistSummary && /:\s*specialist reviewing captured evidence\.?$/i.test(event.message)) return false;
    const key = `${event.type}:${readableEventMessage(event.message).trim().toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return `${url.hostname}${path}`;
  } catch {
    return value;
  }
}

export function RunningView({ audit, events, onCancel }: { audit: Audit; events: AuditEvent[]; onCancel: () => void }) {
  const latestPage = audit.pageStates[audit.pageStates.length - 1];
  const progress = audit.progress.totalProfiles ? Math.min(100, Math.round((audit.progress.completedProfiles / audit.progress.totalProfiles) * 100)) : 8;
  const activity = visibleEvents(events);
  return <main className="running-main">
    <div className="running-heading"><div><p className="panel-kicker">Audit in progress</p><h1>Following the journey.</h1><p className="running-url" title={audit.request.url}><Icon name="external" size={14} /><span>{compactUrl(audit.request.url)}</span></p></div><button className="quiet-button danger-button" type="button" onClick={onCancel}><Icon name="stop" size={15} /> Stop audit</button></div>
    <div className="progress-band"><div className="progress-meta"><span>{audit.progress.phase || 'Preparing browser'}</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><div className="progress-detail">{audit.progress.completedProfiles} of {audit.progress.totalProfiles} profiles reviewed <span>•</span> Evidence is captured as the agent moves</div></div>
    <div className="running-grid">
      <section className="activity-panel" aria-labelledby="activity-title"><div className="section-heading"><div><p className="panel-kicker">Live trace</p><h2 id="activity-title">Agent activity</h2></div><span className="live-indicator"><span />Live</span></div><div className="event-list" aria-live="polite">{activity.length ? activity.map((event) => <div className="event-row" key={`${event.id}-${event.timestamp}`}><span className={`event-icon event-${event.type}`} aria-hidden="true">{eventGlyph(event.type)}</span><div className="event-content"><p>{readableEventMessage(event.message)}</p><time>{humanDate(event.timestamp)}</time></div></div>) : <div className="empty-trace"><span className="spinner" />Waiting for the first browser event…</div>}</div></section>
      <section className="capture-panel" aria-labelledby="capture-title"><div className="section-heading"><div><p className="panel-kicker">Captured state</p><h2 id="capture-title">What the agent sees</h2></div>{latestPage && <span className="state-count">{audit.pageStates.length} state{audit.pageStates.length === 1 ? '' : 's'}</span>}</div>{latestPage ? <><div className="capture-frame">{latestPage.screenshotArtifactId ? <img src={artifactUrl(audit.id, latestPage.screenshotArtifactId)} alt={`Screenshot of ${latestPage.title || latestPage.url}`} /> : <div className="capture-placeholder"><Icon name="eye" size={24} /><span>Screenshot is being prepared</span></div>}<span className="capture-label">{latestPage.title || 'Untitled page'}</span></div><p className="capture-description">{latestPage.description}</p></> : <div className="capture-placeholder capture-empty"><Icon name="eye" size={26} /><span>Waiting for the first page state…</span></div>}</section>
    </div>
    <div className="running-footnote"><Icon name="spark" size={15} /> Findings are reviewed against a profile-specific playbook after the journey completes.</div>
  </main>;
}
