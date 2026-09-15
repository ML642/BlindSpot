import { useCallback, useEffect, useRef, useState } from 'react';
import { terminalStatuses } from '@blindspot/shared';
import { apiJson, getAudit, getEvents } from './lib/api';
import type { Audit, AuditEvent, Screen } from './lib/types';
import { HomeForm } from './components/HomeForm';
import { Icon } from './components/Icon';
import { LogoMark } from './components/LogoMark';
import { ReportView } from './components/ReportView';
import { RunningView } from './components/RunningView';

function Header({ onHome, onNavigate }: { onHome: () => void; onNavigate: (target: 'get-started' | 'info') => void }) {
  return <header className="site-header"><button className="brand" onClick={onHome} aria-label="BlindSpot home"><LogoMark /><span>blindspot</span></button><nav className="site-nav" aria-label="Main navigation"><a href="#get-started" onClick={(event) => { event.preventDefault(); onNavigate('get-started'); }}>Get Started</a><a href="#info" onClick={(event) => { event.preventDefault(); onNavigate('info'); }}>Info</a></nav></header>;
}

export function App() {
  const [screen, setScreen] = useState<Screen>('form');
  const [audit, setAudit] = useState<Audit | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [appError, setAppError] = useState('');
  const eventCursor = useRef(0);

  useEffect(() => {
    const savedId = new URLSearchParams(window.location.search).get('audit');
    if (!savedId) return;
    setScreen('running');
    getAudit(savedId).then((savedAudit) => { setAudit(savedAudit); setScreen(terminalStatuses.includes(savedAudit.status) ? 'report' : 'running'); }).catch((error) => { setAppError(error instanceof Error ? error.message : 'Could not restore the audit.'); setScreen('form'); });
  }, []);

  const startAudit = useCallback((auditId: string) => {
    eventCursor.current = 0;
    setAudit(null); setEvents([]); setAppError(''); setScreen('running');
    window.history.pushState({ auditId }, '', `?audit=${encodeURIComponent(auditId)}`);
    getAudit(auditId).then(setAudit).catch((error) => { setAppError(error instanceof Error ? error.message : 'Could not load the audit.'); setScreen('form'); });
  }, []);

  useEffect(() => {
    const auditId = audit?.id;
    if (screen !== 'running' || !auditId) return;
    let active = true;
    const poll = async () => {
      try {
        const [nextAudit, eventPayload] = await Promise.all([getAudit(auditId), getEvents(auditId, eventCursor.current)]);
        if (!active) return;
        setAudit(nextAudit);
        if (eventPayload.events.length) {
          eventCursor.current = Math.max(eventCursor.current, ...eventPayload.events.map((event) => event.id));
          setEvents((previous) => [...previous, ...eventPayload.events].slice(-80));
        }
        if (terminalStatuses.includes(nextAudit.status)) setScreen('report');
      } catch (error) { if (active) setAppError(error instanceof Error ? error.message : 'The audit connection was interrupted.'); }
    };
    const interval = window.setInterval(poll, 2000);
    void poll();
    return () => { active = false; window.clearInterval(interval); };
  }, [audit?.id, screen]);

  const cancelAudit = async () => {
    if (!audit) return;
    try {
      await apiJson(`/audits/${encodeURIComponent(audit.id)}/cancel`, { method: 'POST' });
      const nextAudit = await getAudit(audit.id);
      setAudit(nextAudit);
      if (terminalStatuses.includes(nextAudit.status)) setScreen('report');
    } catch (error) { setAppError(error instanceof Error ? error.message : 'Could not stop the audit.'); }
  };

  const home = () => { window.history.replaceState({}, '', window.location.pathname); setScreen('form'); setAudit(null); setEvents([]); setAppError(''); };
  const navigateHome = (target: 'get-started' | 'info') => {
    home();
    window.history.replaceState({}, '', `${window.location.pathname}#${target}`);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
  };
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a><Header onHome={home} onNavigate={navigateHome} />{appError && <div className="global-alert" role="alert"><Icon name="x" size={16} />{appError}<button type="button" onClick={() => setAppError('')} aria-label="Dismiss message"><Icon name="x" size={15} /></button></div>}<div id="main-content" tabIndex={-1} />{screen === 'running' && !audit && <main className="running-main" aria-busy="true"><h1>Loading audit…</h1><p role="status">Retrieving the latest progress and evidence.</p></main>}{screen === 'form' && <HomeForm onStarted={startAudit} />}{screen === 'running' && audit && <RunningView audit={audit} events={events} onCancel={cancelAudit} />}{screen === 'report' && audit && <ReportView audit={audit} onNewAudit={home} />}<footer className="site-footer"><span>blindspot / 2026</span><span>Built for more ways to navigate</span></footer></div>;
}
