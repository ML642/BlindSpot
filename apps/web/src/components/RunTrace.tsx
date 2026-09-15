import { useEffect, useState } from 'react';
import type { Audit, AuditEvent, PageState } from '@blindspot/shared';
import { artifactUrl, getEvents } from '../lib/api';
import { downloadFile } from '../lib/format';

type TraceEntry = { id: string; timestamp: string; type: string; message: string; pageStateId?: string; page?: PageState };
function clock(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString('en-GB', { hour12: false });
}
function safePageUrl(url: string) {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) ? url : undefined; } catch { return undefined; }
}

function TraceBrowser({ audit }: { audit: Audit }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState('all');
  const [selection, setSelection] = useState<string>();
  const [failedImage, setFailedImage] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError('');
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    getEvents(audit.id, 0, controller.signal).then(result => { if (active) setEvents(result.events); }).catch(() => {
      if (active) setError('Could not load the event log. Saved page states are still available.');
    }).finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [audit.id, attempt]);
  const entries: TraceEntry[] = [
    ...events.map(event => ({ ...event, id: `event-${event.id}` })),
    ...audit.pageStates.map(page => ({ id: `page-${page.id}`, timestamp: page.capturedAt, type: 'capture', message: page.title || page.url, pageStateId: page.id, page })),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const visible = entries.filter(entry => filter === 'all' || (filter === 'pages' ? ['capture', 'navigation'].includes(entry.type) : ['warning', 'error'].includes(entry.type)));
  const selected = visible.find(entry => entry.id === selection) ?? visible[0];
  // Only associate explicitly recorded page IDs; a nearby timestamp is not evidence of a relationship.
  const page = selected?.page ?? audit.pageStates.find(state => state.id === selected?.pageStateId);
  const screenshot = artifactUrl(audit.id, page?.screenshotArtifactId);
  const pageUrl = page && safePageUrl(page.url);
  return <div className="trace-browser">
    <div className="trace-toolbar"><p>Recorded actions and page captures. Not an interactive replay.</p><button className="quiet-button" type="button" disabled={loading} onClick={() => downloadFile(`blindspot-${audit.id}-trace.json`, JSON.stringify({ auditId: audit.id, events, pageStates: audit.pageStates, eventLogLoaded: !error && !loading }, null, 2), 'application/json')}>Download trace</button></div>
    {loading && <p role="status">Loading saved events…</p>}
    {error && <p role="alert">{error} <button className="quiet-button" type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>}
    {!loading && !error && !events.length && <p>No events were saved for this run. Any captured pages are listed below.</p>}
    <div className="trace-layout"><section className="trace-timeline" aria-label="Trace timeline"><label className="report-profile-filter">Show<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All activity</option><option value="pages">Navigation and pages</option><option value="warnings">Warnings and errors</option></select></label>
      <ol>{visible.map(entry => <li key={entry.id}><button className="issue-list-row" type="button" aria-pressed={selected?.id === entry.id} aria-controls="trace-inspector" onClick={() => setSelection(entry.id)}><span><small><time>{clock(entry.timestamp)}</time> · {entry.type}</small><strong>{entry.message}</strong>{entry.page && <small>{entry.page.url}</small>}</span></button></li>)}</ol>
      {!visible.length && <p>No recorded entries match this filter.</p>}
    </section><section id="trace-inspector" className="trace-inspector" aria-label="Trace entry details">
      {selected ? <><p className="issue-eyebrow">{clock(selected.timestamp)} · {selected.type}</p><h3>{selected.message}</h3>
        {page ? <><p>{pageUrl ? <a href={pageUrl} target="_blank" rel="noopener noreferrer">{page.url}</a> : page.url}</p><p>{page.description}</p>
          <div className="trace-artifacts">{([['Rendered DOM', page.domArtifactId], ['Accessibility snapshot', page.accessibilityArtifactId]] as const).map(([label, id]) => id ? <a key={id} href={artifactUrl(audit.id, id)} target="_blank" rel="noopener noreferrer">{label}</a> : null)}</div>
          {screenshot && failedImage !== screenshot ? <figure><a href={screenshot} target="_blank" rel="noopener noreferrer"><img src={screenshot} alt={`Captured state: ${page.title || page.url}`} onError={() => setFailedImage(screenshot)} /></a><figcaption>Saved page state. Open the image for full size.</figcaption></figure> : <p>{screenshot ? 'The saved screenshot could not be loaded.' : 'No screenshot saved for this state.'}</p>}
        </> : <p>This event has no linked page capture. Select "Navigation and pages" to inspect saved states.</p>}
      </> : <p>No trace entry selected.</p>}
    </section></div>
  </div>;
}

export function RunTrace({ audit }: { audit: Audit }) {
  const [open, setOpen] = useState(false);
  return <details className="report-secondary run-trace" onToggle={event => setOpen(event.currentTarget.open)}><summary>Run trace · debug</summary>{open && <TraceBrowser key={audit.id} audit={audit} />}</details>;
}
