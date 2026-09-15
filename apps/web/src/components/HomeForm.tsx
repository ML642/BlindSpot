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

  return <main className="home-main">
    <section className="intro-column" aria-labelledby="home-title">
      <h1 id="home-title">Audit a real user journey.</h1>
      <p className="intro-copy">Describe what someone needs to do. BlindSpot follows the path in a real browser and returns evidence for the people conventional scans miss.</p>
    </section>
    <section className="form-panel" aria-labelledby="audit-form-title">
      <div className="form-panel-top"><span className="panel-number">01</span><div><p className="panel-kicker">Start an audit</p><h2 id="audit-form-title">Give us a place to look.</h2></div></div>
      <form onSubmit={submit} noValidate>
        <div className="form-fields"><div className="field-block"><label htmlFor="website-url">Website address</label><div className="input-shell"><span className="input-prefix" aria-hidden="true">↗</span><input id="website-url" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck="false" autoComplete="url" aria-describedby="url-help" /></div><p className="field-help" id="url-help">The agent visits this public URL in a fresh, headless browser.</p></div>
          <div className="field-block"><label htmlFor="audit-scenario">What should we check?</label><textarea id="audit-scenario" rows={5} value={scenario} onChange={(event) => setScenario(event.target.value)} aria-describedby="scenario-help" /><p className="field-help" id="scenario-help">Include the task, entry point, and what “done” looks like.</p></div>
          {error && <div className="form-error" role="alert"><Icon name="x" size={16} />{error}</div>}
          <button className="primary-button" type="submit" disabled={busy || demoBusy}>{busy ? <><span className="spinner" /> Starting audit…</> : <>Run accessibility audit <Icon name="arrow" size={18} /></>}</button>
          <div className="form-footer"><span>Usually takes 2–6 minutes</span><span className="footer-dot" /><span>{health?.geminiConfigured ? 'Powered by Gemini' : 'Provider not configured'}</span></div>
        </div>
        <ProfilePicker selected={selected} onChange={setSelected} />
      </form>
      <div className="demo-divider"><span>or</span></div>
      <button type="button" className="demo-button" onClick={demo} disabled={busy || demoBusy}>{demoBusy ? <><span className="spinner spinner-dark" /> Loading sample…</> : <><Icon name="spark" size={16} /> Explore a sample report <Icon name="arrow" size={16} /></>}</button>
      <p className="demo-note">A prebuilt result for a quick walkthrough. It does not contact Gemini.</p>
    </section>
  </main>;
}
