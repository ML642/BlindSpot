import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * bad-signup.tsx
 *
 * A sign-up flow that looks polished but is intentionally hostile to keyboard
 * and screen-reader users. It is NEGATIVE test data for an automated
 * accessibility agent. Every deliberate defect is marked with `// TRAP:`.
 *
 * Trap map — where a keyboard / screen-reader agent should get stuck:
 *  1. Clickable <div>/<span> controls with no tabIndex, role or key handlers:
 *     submit, password "Show/Hide", the terms checkbox, and the modal's
 *     close (x), "Decline" and "I agree". None can be reached with Tab.
 *  2. No <label> anywhere. Accessible names fall back to placeholders, so the
 *     e-mail field is announced as "you@example.com" and the password field
 *     as "••••••••".
 *  3. The country dropdown is a stack of <div>s: not focusable, no
 *     aria-expanded / listbox / option semantics, opens and selects on mouse
 *     click only.
 *  4. The Terms modal has no role="dialog" / aria-modal, does not move focus
 *     in, does not trap Tab, ignores Escape, never restores focus, and leaves
 *     the covered page fully focusable and readable. It can only be closed
 *     with a mouse. (The trigger link IS reachable by Tab on purpose — that is
 *     the only way for a keyboard agent to open the modal and observe the
 *     missing focus trap.)
 *  5. Bonus defects: no <form> (Enter never submits), no <h1>, focus ring
 *     removed, errors not associated with fields nor announced, success state
 *     not announced (focus silently drops to <body>).
 */

const COUNTRIES = [
  'United States',
  'United Kingdom',
  'Germany',
  'Poland',
  'France',
  'Spain',
  'Japan',
  'Brazil',
] as const;

interface FormValues {
  fullName: string;
  email: string;
  password: string;
  country: string;
  acceptedTerms: boolean;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;

const INITIAL_VALUES: FormValues = {
  fullName: '',
  email: '',
  password: '',
  country: '',
  acceptedTerms: false,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (values.fullName.trim().length < 2) errors.fullName = 'Please enter your full name.';
  if (!EMAIL_PATTERN.test(values.email)) errors.email = 'Please enter a valid email address.';
  if (values.password.length < 8) errors.password = 'Password must be at least 8 characters.';
  if (!values.country) errors.country = 'Please select your country.';
  if (!values.acceptedTerms) errors.acceptedTerms = 'You must accept the Terms and Conditions.';

  return errors;
}

function inputClassName(hasError: boolean): string {
  return [
    'w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition',
    'placeholder:text-slate-500',
    // TRAP: browser focus ring removed and never replaced (WCAG 2.4.7).
    'outline-none',
    hasError ? 'border-red-500' : 'border-slate-300 hover:border-slate-400',
  ].join(' ');
}

/* -------------------------------------------------------------------------- */
/* Presentational helpers                                                      */
/* -------------------------------------------------------------------------- */

function PageShell({ children }: { children: ReactNode }) {
  // TRAP: no <main> landmark.
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-900/5">
        {children}
      </div>
    </div>
  );
}

// TRAP: decorative SVGs are not hidden from assistive technology.
function ChevronDownIcon() {
  return (
    <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="none">
      <path
        d="M6 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none">
      <path
        d="M5 10.5l3 3 7-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
      <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  // TRAP: not linked to any field (no id / aria-describedby) and never announced.
  return <div className="mt-1.5 text-sm text-red-600">{children}</div>;
}

function TermsText() {
  return (
    <>
      <p>
        By creating an account you agree to be bound by these Terms and Conditions. Please read
        them carefully before continuing.
      </p>
      <p>
        <strong className="font-semibold text-slate-800">1. Your account.</strong> You are
        responsible for keeping your password confidential and for all activity that occurs under
        your account. Notify us immediately of any unauthorised use.
      </p>
      <p>
        <strong className="font-semibold text-slate-800">2. Acceptable use.</strong> You agree not
        to misuse the service, interfere with its normal operation, or access it using a method
        other than the interface we provide.
      </p>
      <p>
        <strong className="font-semibold text-slate-800">3. Subscription and billing.</strong> Your
        free trial lasts 14 days. After the trial ends you will not be charged unless you choose a
        paid plan.
      </p>
      <p>
        <strong className="font-semibold text-slate-800">4. Privacy.</strong> We process your
        personal data as described in our{' '}
        <a
          href="/privacy"
          className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
        >
          privacy policy
        </a>
        .
      </p>
      <p>
        <strong className="font-semibold text-slate-800">5. Termination.</strong> You may close your
        account at any time from the settings page. We may suspend accounts that violate these
        terms.
      </p>
      <p>
        <strong className="font-semibold text-slate-800">6. Changes to these terms.</strong> We may
        update these terms from time to time. Continued use of the service after changes take
        effect constitutes acceptance.
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Custom dropdown (mouse only)                                                */
/* -------------------------------------------------------------------------- */

interface CountryDropdownProps {
  value: string;
  onChange: (value: string) => void;
  hasError: boolean;
}

function BadCountryDropdown({ value, onChange, hasError }: CountryDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown);

    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      {/*
        TRAP: the trigger is a <div> with only onClick — no tabIndex, no role,
        no aria-expanded / aria-haspopup, no key handling. A keyboard user can
        neither focus nor open it; a screen reader sees plain static text.
      */}
      <div
        className={`${inputClassName(hasError)} flex cursor-pointer items-center justify-between`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className={value ? 'text-slate-900' : 'text-slate-500'}>
          {value || 'Select your country'}
        </span>
        <ChevronDownIcon />
      </div>

      {isOpen && (
        <div className="absolute z-10 mt-1.5 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {COUNTRIES.map((country) => (
            // TRAP: options are plain <div>s — not focusable, no role="option",
            // no aria-selected, mouse click only.
            <div
              key={country}
              className="flex cursor-pointer items-center justify-between px-3.5 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
              onClick={() => {
                onChange(country);
                setIsOpen(false);
              }}
            >
              {country}
              {country === value && <CheckIcon className="h-4 w-4 text-indigo-600" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Terms modal (no dialog semantics, no focus management)                      */
/* -------------------------------------------------------------------------- */

interface TermsModalProps {
  onClose: () => void;
  onAgree: () => void;
}

function BadTermsModal({ onClose, onAgree }: TermsModalProps) {
  /*
    TRAP: this is just a fixed-position <div>. There is no role="dialog",
    no aria-modal="true", no aria-labelledby. Focus is not moved into the
    modal on open, Tab is not trapped, Escape does nothing, focus is not
    restored on close, and the page underneath is neither inert nor
    aria-hidden — Tab and the screen-reader virtual cursor walk straight
    through the covered form.
  */
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-lg font-semibold">Terms and Conditions</div>
            <div className="mt-0.5 text-sm text-slate-500">Last updated: March 2026</div>
          </div>
          {/* TRAP: icon-only close control as a <span> — no name, not focusable. */}
          <span
            className="-mr-2 -mt-1 cursor-pointer rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
          >
            <XIcon />
          </span>
        </div>

        {/*
          TRAP: scrollable region without tabIndex — in Firefox and Safari it
          cannot be scrolled from the keyboard at all.
        */}
        <div className="max-h-72 space-y-4 overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600">
          <TermsText />
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          {/* TRAP: footer "buttons" are <div>s — the modal cannot be dismissed without a mouse. */}
          <div
            className="cursor-pointer select-none rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            Decline
          </div>
          <div
            className="cursor-pointer select-none rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            onClick={onAgree}
          >
            I agree
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function BadSignup() {
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const updateField = <K extends keyof FormValues>(field: K, fieldValue: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: fieldValue }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const handleSubmit = () => {
    const nextErrors = validate(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length === 0) setIsSubmitted(true);
  };

  if (isSubmitted) {
    // TRAP: no heading, no live region, and the element that had focus has just
    // been unmounted — focus silently drops to <body>. A screen reader hears nothing.
    return (
      <PageShell>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <CheckIcon className="h-6 w-6 text-green-600" />
        </div>
        <div className="mt-4 text-center text-2xl font-semibold tracking-tight">
          Welcome aboard, {values.fullName}!
        </div>
        <div className="mt-2 text-center text-sm text-slate-500">
          We&apos;ve sent a confirmation link to {values.email}.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* TRAP: heading is a styled <div>, not <h1> — invisible to heading navigation. */}
      <div className="text-2xl font-semibold tracking-tight">Create your account</div>
      <div className="mt-1 text-sm text-slate-500">
        Start your 14-day free trial. No credit card required.
      </div>

      {/* TRAP: no <form> element — pressing Enter in a field never submits. */}
      <div className="mt-8 space-y-5">
        <div>
          {/* TRAP: no <label>. The placeholder is the only hint and it disappears on input. */}
          <input
            className={inputClassName(Boolean(errors.fullName))}
            placeholder="Full name"
            value={values.fullName}
            onChange={(event) => updateField('fullName', event.target.value)}
          />
          {errors.fullName && <ErrorText>{errors.fullName}</ErrorText>}
        </div>

        <div>
          {/* TRAP: no <label>, type="text" — accessible name becomes "you@example.com". */}
          <input
            className={inputClassName(Boolean(errors.email))}
            type="text"
            placeholder="you@example.com"
            value={values.email}
            onChange={(event) => updateField('email', event.target.value)}
          />
          {errors.email && <ErrorText>{errors.email}</ErrorText>}
        </div>

        <div>
          <div className="relative">
            {/* TRAP: no <label> — accessible name becomes "••••••••". */}
            <input
              className={`${inputClassName(Boolean(errors.password))} pr-16`}
              type={isPasswordVisible ? 'text' : 'password'}
              placeholder="••••••••"
              value={values.password}
              onChange={(event) => updateField('password', event.target.value)}
            />
            {/* TRAP: <span> toggle — no role, no tabIndex, no aria-pressed; unreachable by keyboard. */}
            <span
              className="absolute inset-y-1 right-1 flex cursor-pointer select-none items-center rounded-md px-2.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              onClick={() => setIsPasswordVisible((visible) => !visible)}
            >
              {isPasswordVisible ? 'Hide' : 'Show'}
            </span>
          </div>
          {errors.password && <ErrorText>{errors.password}</ErrorText>}
        </div>

        <div>
          <BadCountryDropdown
            value={values.country}
            onChange={(country) => updateField('country', country)}
            hasError={Boolean(errors.country)}
          />
          {errors.country && <ErrorText>{errors.country}</ErrorText>}
        </div>

        <div>
          <div className="flex items-start gap-3">
            {/*
              TRAP: the checkbox is a <div>. It cannot be focused or toggled with
              the keyboard, so the form can never be completed without a mouse.
              Clicking the text next to it does nothing either (no <label>).
            */}
            <div
              className={`mt-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border ${
                values.acceptedTerms ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300 bg-white'
              }`}
              onClick={() => updateField('acceptedTerms', !values.acceptedTerms)}
            >
              {values.acceptedTerms && <CheckIcon className="h-3 w-3 text-white" />}
            </div>
            <span className="text-sm text-slate-600">
              I agree to the{' '}
              {/*
                Deliberately a real <a href="#"> so it IS reachable by Tab — this is
                the keyboard user's only way into the modal, which is what exposes
                the missing focus trap. (A link that behaves like a button is still
                a defect: "link" role, "#" href, page scrolls to top if JS fails.)
              */}
              <a
                href="#"
                className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
                onClick={(event) => {
                  event.preventDefault();
                  setIsTermsOpen(true);
                }}
              >
                Terms and Conditions
              </a>
            </span>
          </div>
          {errors.acceptedTerms && <ErrorText>{errors.acceptedTerms}</ErrorText>}
        </div>

        {/* TRAP: the submit "button" is a <div> with onClick — unreachable by Tab, Enter/Space do nothing. */}
        <div
          className="flex w-full cursor-pointer select-none items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          onClick={handleSubmit}
        >
          Create account
        </div>
      </div>

      <div className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <a href="/login" className="font-medium text-indigo-600 hover:text-indigo-700">
          Sign in
        </a>
      </div>

      {isTermsOpen && (
        <BadTermsModal
          onClose={() => setIsTermsOpen(false)}
          onAgree={() => {
            updateField('acceptedTerms', true);
            setIsTermsOpen(false);
          }}
        />
      )}
    </PageShell>
  );
}
