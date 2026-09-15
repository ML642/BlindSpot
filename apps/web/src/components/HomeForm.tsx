import { useEffect, useRef, useState, type FormEvent } from 'react';
import { profiles, type AuditRequest, type ProfileId } from '@blindspot/shared';
import { apiJson } from '../lib/api';
import { Icon } from './Icon';
import { ProfilePicker } from './ProfilePicker';

const initialScenario = 'Check the sign-in flow from the homepage. Find the login entry point, open the form, and verify that a keyboard and screen reader user can understand, complete, and recover from an empty submission.';
type FormStep = 'url' | 'url-exiting' | 'scenario' | 'scenario-exiting' | 'scenario-back-exiting' | 'profiles' | 'profiles-exiting';

export function HomeForm({ onStarted }: { onStarted: (auditId: string) => void }) {
  const [url, setUrl] = useState('https://');
  const [scenario, setScenario] = useState(initialScenario);
  const [selected, setSelected] = useState<ProfileId[]>(profiles.map((profile) => profile.id));
  const [step, setStep] = useState<FormStep>('url');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const transitionTimer = useRef<number | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const scenarioInput = useRef<HTMLTextAreaElement>(null);
  const profilesStep = useRef<HTMLDivElement>(null);
  const shouldFocusUrl = useRef(false);

  useEffect(() => () => {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
  }, []);

  useEffect(() => {
    let shouldAlign = false;
    if (step === 'url' && shouldFocusUrl.current) {
      urlInput.current?.focus({ preventScroll: true });
      shouldFocusUrl.current = false;
      shouldAlign = true;
    }
    if (step === 'scenario') {
      scenarioInput.current?.focus({ preventScroll: true });
      shouldAlign = true;
    }
    if (step === 'profiles') {
      profilesStep.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
      shouldAlign = true;
    }
    if (shouldAlign) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const headerHeight = document.querySelector<HTMLElement>('.site-header')?.offsetHeight ?? 0;
      const titleTop = document.getElementById('home-title')?.getBoundingClientRect().top;
      const alignedTop = titleTop === undefined ? headerHeight : Math.max(headerHeight, window.scrollY + titleTop - 24);
      window.scrollTo({ top: alignedTop, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }, [step]);

  const showStepAfterTransition = (nextStep: FormStep) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    transitionTimer.current = window.setTimeout(() => setStep(nextStep), reduceMotion ? 0 : 220);
  };

  const goBack = () => {
    setError('');
    if (step === 'scenario') {
      shouldFocusUrl.current = true;
      setStep('scenario-back-exiting');
      showStepAfterTransition('url');
    }
    if (step === 'profiles') {
      setStep('profiles-exiting');
      showStepAfterTransition('scenario');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (step.endsWith('exiting')) return;
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return setError('Enter a complete HTTP or HTTPS address.');
    if (step === 'url' || step === 'url-exiting') {
      if (step === 'url-exiting') return;
      setStep('url-exiting');
      showStepAfterTransition('scenario');
      return;
    }
    if (scenario.trim().length < 10) return setError('Describe a scenario in at least 10 characters.');
    if (step === 'scenario' || step === 'scenario-exiting') {
      if (step === 'scenario-exiting') return;
      setStep('scenario-exiting');
      showStepAfterTransition('profiles');
      return;
    }
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

  return <main className="home-main simple-home">
    <section className="home-hero" aria-labelledby="home-title">
      <div className="intro-column">
        <h1 id="home-title">See your website’s blind spots.</h1>
        <p className="intro-copy">Enter a URL to begin an accessibility review.</p>
      </div>
      <div className="form-panel" id="get-started">
      <form onSubmit={submit} noValidate>
        <div className="form-fields">
          {(step === 'url' || step === 'url-exiting') && <div className={`wizard-step url-step is-entering${step === 'url-exiting' ? ' is-exiting' : ''}`}>
            <div className="field-block url-field"><label htmlFor="website-url">Website URL</label><div className="url-entry"><div className="input-shell"><span className="input-prefix" aria-hidden="true">↗</span><input ref={urlInput} id="website-url" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck="false" autoComplete="url" /></div><button className="primary-button" type="submit" disabled={step === 'url-exiting'}>Check website <Icon name="arrow" size={18} /></button></div><p className="url-description">BlindSpot visits your website, follows a task, and reports barriers with practical evidence and recommendations.</p></div>
          </div>}
          {(step === 'scenario' || step === 'scenario-exiting' || step === 'scenario-back-exiting') && <div className={`wizard-step scenario-step is-entering${step !== 'scenario' ? ' is-exiting' : ''}`}>
            <div className="selected-url"><span>Website</span><strong>{url}</strong></div>
            <div className="field-block"><label htmlFor="audit-scenario">What should we check?</label><textarea ref={scenarioInput} id="audit-scenario" rows={5} value={scenario} onChange={(event) => setScenario(event.target.value)} aria-describedby="scenario-help" /><p className="field-help" id="scenario-help">Include the task, entry point, and what “done” looks like.</p></div>
            <div className="step-actions"><button type="button" className="quiet-button step-back" onClick={goBack} disabled={step !== 'scenario'}>Back</button><button className="primary-button" type="submit" disabled={step !== 'scenario'}>Continue <Icon name="arrow" size={18} /></button></div>
          </div>}
          {(step === 'profiles' || step === 'profiles-exiting') && <div ref={profilesStep} className={`wizard-step profiles-step is-entering${step === 'profiles-exiting' ? ' is-exiting' : ''}`}>
            <ProfilePicker selected={selected} onChange={setSelected} />
            <div className="step-actions"><button type="button" className="quiet-button step-back" onClick={goBack} disabled={step !== 'profiles' || busy}>Back</button><button className="primary-button" type="submit" disabled={step !== 'profiles' || busy}>{busy ? <><span className="spinner" /> Starting audit…</> : <>Start audit <Icon name="arrow" size={18} /></>}</button></div>
          </div>}
          {error && <div className="form-error" role="alert"><Icon name="x" size={16} />{error}</div>}
        </div>
      </form>
      </div>
    </section>
  </main>;
}
