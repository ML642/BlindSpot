import { useState, type FormEvent } from 'react';
import { profiles, type AuditRequest, type ProfileId } from '@blindspot/shared';
import type { Health } from '../lib/types';
import { apiJson } from '../lib/api';
import { Icon } from './Icon';
import { ProfilePicker } from './ProfilePicker';

const initialScenario = 'Check the sign-in flow from the homepage. Find the login entry point, open the form, and verify that a keyboard and screen reader user can understand, complete, and recover from an empty submission.';

export function HomeForm({ health, onStarted }: { health: Health | null; onStarted: (auditId: string) => void }) {
  const [url, setUrl] = useState('https://');
  const [scenario, setScenario] = useState(initialScenario);
  const [selected, setSelected] = useState<ProfileId[]>(profiles.map((profile) => profile.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return setError('Enter a complete HTTP or HTTPS address.');
    if (scenario.trim().length < 10) return setError('Describe a scenario in at least 10 characters.');
    if (!selected.length) return setError('Select at least one user profile.');
    setBusy(true);
    try {
      const payload: AuditRequest = { url, scenario: scenario.trim(), profileIds: selected };
      const result = await apiJson<{ id: string }>('/audits', { method: 'POST', body: JSON.stringify(payload) });
      onStarted(result.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not start the audit.');
    } finally { setBusy(false); }
  };

  const demo = async () => {
    setError('');
    setDemoBusy(true);
    try {
      const result = await apiJson<{ id: string }>('/demo', { method: 'POST' });
      onStarted(result.id);
    } catch (demoError) {
      setError(demoError instanceof Error ? demoError.message : 'The sample report could not be loaded.');
    } finally { setDemoBusy(false); }
  };

  return <main className="home-main simple-home">
    <section className="home-hero" aria-labelledby="home-title">
      <div className="intro-column">
        <h1 id="home-title">See your website’s blind spots.</h1>
        <p className="intro-copy">Enter a URL to begin an accessibility review.</p>
      </div>
      <div className="form-panel" id="get-started">
      <form onSubmit={submit} noValidate>
        <div className="form-fields">
          <div className="field-block url-field"><label htmlFor="website-url">Website URL</label><div className="url-entry"><div className="input-shell"><span className="input-prefix" aria-hidden="true">↗</span><input id="website-url" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck="false" autoComplete="url" aria-describedby="url-help" /></div><button className="primary-button" type="submit" disabled={busy || demoBusy}>{busy ? <><span className="spinner" /> Checking…</> : <>Check website <Icon name="arrow" size={18} /></>}</button></div><p className="field-help" id="url-help">Enter a public HTTP or HTTPS address.</p></div>
          {error && <div className="form-error" role="alert"><Icon name="x" size={16} />{error}</div>}
          <details className="audit-options">
            <summary>Audit options</summary>
            <div className="field-block"><label htmlFor="audit-scenario">What should we check?</label><textarea id="audit-scenario" rows={5} value={scenario} onChange={(event) => setScenario(event.target.value)} aria-describedby="scenario-help" /><p className="field-help" id="scenario-help">Include the task, entry point, and what “done” looks like.</p></div>
            <ProfilePicker selected={selected} onChange={setSelected} />
          </details>
          <div className="form-footer"><span>You can stop the audit at any time</span><span className="footer-dot" /><span>{health?.geminiConfigured ? 'AI review ready' : 'Provider not configured'}</span></div>
        </div>
      </form>
      <div className="demo-divider"><span>or</span></div>
      <button type="button" className="demo-button" onClick={demo} disabled={busy || demoBusy}>{demoBusy ? <><span className="spinner spinner-dark" /> Loading sample…</> : <><Icon name="external" size={16} /> Explore a sample report <Icon name="arrow" size={16} /></>}</button>
      </div>
    </section>
    <section className="home-info" id="info" aria-labelledby="info-title">
      <h2 id="info-title">Accessibility through real user journeys.</h2>
      <p>BlindSpot visits your website, follows a task, and reports barriers with practical evidence and recommendations.</p>
    </section>
  </main>;
}
