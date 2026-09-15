import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';

/**
 * good-signup.tsx
 *
 * The same sign-up flow as bad-signup.tsx — pixel-identical at rest — but
 * fully operable with a keyboard and a screen reader:
 *
 *  - Semantic landmarks and controls: <main>, <h1>, <form>, <button>,
 *    <label htmlFor>. Labels are visually hidden with `sr-only` ONLY to keep
 *    visual parity with the bad version; in production drop `sr-only` to show
 *    them, which is the better UX.
 *  - Country picker follows the WAI-ARIA APG "select-only combobox" pattern:
 *    role="combobox" + aria-expanded/aria-controls/aria-activedescendant,
 *    role="listbox"/"option", Arrow/Home/End/Enter/Space/Escape/Tab and
 *    first-letter type-ahead.
 *  - Terms dialog is a native <dialog> opened with showModal() (inert
 *    background, Escape to close, focus restored), with an explicit
 *    Tab / Shift+Tab wrap so focus never leaves the dialog.
 *  - Errors are linked with aria-describedby / aria-invalid and focus jumps to
 *    the first invalid field on submit. The success heading receives focus.
 *  - Every operable control has a visible focus indicator.
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

const FIELD_ORDER: Array<keyof FormValues> = [
  'fullName',
  'email',
  'password',
  'country',
  'acceptedTerms',
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';

/** Inset variant for elements flush with a clipping container (e.g. inside <dialog>). */
const FOCUS_RING_INSET =
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

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
    FOCUS_RING,
    hasError ? 'border-red-500' : 'border-slate-300 hover:border-slate-400',
  ].join(' ');
}

/* -------------------------------------------------------------------------- */
/* Presentational helpers                                                      */
/* -------------------------------------------------------------------------- */

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-900/5">
        {children}
      </div>
    </main>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
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
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ErrorText({ id, children }: { id: string; children: ReactNode }) {
  // Referenced by the field's aria-describedby, so it is announced with the field.
  return (
    <p id={id} className="mt-1.5 text-sm text-red-600">
      {children}
    </p>
  );
}

function TermsText({ introId }: { introId: string }) {
  return (
    <>
      <p id={introId}>
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
          className={`rounded font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700 ${FOCUS_RING}`}
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
/* Country combobox (WAI-ARIA APG "select-only combobox")                      */
/* -------------------------------------------------------------------------- */

interface CountryComboboxProps {
  id: string;
  /** id of the visually hidden label; a <label htmlFor> cannot target a div. */
  labelId: string;
  value: string;
  onChange: (value: string) => void;
  hasError: boolean;
  describedBy?: string | undefined;
  triggerRef?: Ref<HTMLDivElement> | undefined;
}

function CountryCombobox({
  id,
  labelId,
  value,
  onChange,
  hasError,
  describedBy,
  triggerRef,
}: CountryComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const selectedIndex = COUNTRIES.findIndex((country) => country === value);

  const openList = (initialIndex?: number) => {
    setActiveIndex(initialIndex ?? (selectedIndex >= 0 ? selectedIndex : 0));
    setIsOpen(true);
  };

  const closeList = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const selectIndex = (index: number) => {
    const country = COUNTRIES[index];
    if (country) onChange(country);
    closeList();
  };

  /** First option after `fromIndex` (wrapping) whose name starts with `char`. */
  const findMatch = (char: string, fromIndex: number): number | null => {
    const needle = char.toLowerCase();

    for (let step = 1; step <= COUNTRIES.length; step += 1) {
      const index = (fromIndex + step) % COUNTRIES.length;
      if (COUNTRIES[index]?.toLowerCase().startsWith(needle)) return index;
    }

    return null;
  };

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeList();
    };

    document.addEventListener('mousedown', handleMouseDown);

    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;

    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const { key, altKey } = event;
    const isPrintable = key.length === 1 && key !== ' ';

    if (!isOpen) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        openList();
      } else if (isPrintable) {
        event.preventDefault();
        openList(findMatch(key, selectedIndex) ?? undefined);
      }

      return;
    }

    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, COUNTRIES.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (altKey) {
          selectIndex(activeIndex);
        } else {
          setActiveIndex((index) => Math.max(index - 1, 0));
        }
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(COUNTRIES.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectIndex(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        closeList();
        break;
      case 'Tab':
        // APG: Tab commits the highlighted option and lets focus move on naturally.
        selectIndex(activeIndex);
        break;
      default:
        if (isPrintable) {
          event.preventDefault();
          setActiveIndex((index) => findMatch(key, index) ?? index);
        }
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget)) closeList();
      }}
    >
      {/*
        A <div role="combobox"> rather than <button>: the APG pattern needs full
        control over Enter/Space/Arrow handling, and a native button's implicit
        Space→click activation would fight the keydown handler.
      */}
      <div
        ref={triggerRef}
        id={id}
        role="combobox"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-required="true"
        aria-invalid={hasError}
        aria-describedby={describedBy}
        className={`${inputClassName(hasError)} flex cursor-pointer items-center justify-between`}
        onClick={() => (isOpen ? closeList() : openList())}
        onKeyDown={handleKeyDown}
      >
        <span className={value ? 'text-slate-900' : 'text-slate-500'}>
          {value || 'Select your country'}
        </span>
        <ChevronDownIcon />
      </div>

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className="absolute z-10 mt-1.5 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          // Keep focus on the combobox while the mouse interacts with the list
          // (otherwise the blur handler would close it before click fires).
          onMouseDown={(event) => event.preventDefault()}
        >
          {COUNTRIES.map((country, index) => {
            const isSelected = country === value;
            const isActive = index === activeIndex;

            return (
              <li
                key={country}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                className={`flex cursor-pointer items-center justify-between px-3.5 py-2 text-sm ${
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectIndex(index)}
              >
                {country}
                {isSelected && <CheckIcon className="h-4 w-4 text-indigo-600" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Terms dialog (native <dialog> + explicit focus wrap)                        */
/* -------------------------------------------------------------------------- */

interface TermsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAgree: () => void;
}

function TermsDialog({ isOpen, onClose, onAgree }: TermsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const introId = useId();

  // Sync React state with the native dialog. showModal() puts the dialog in the
  // top layer, makes the rest of the document inert and wires up Escape.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
      // Long content: start reading from the heading rather than the first button.
      headingRef.current?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Wrap Tab / Shift+Tab inside the dialog. The inert background already keeps
  // focus out of the page; this additionally stops it escaping to browser chrome.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    const active = document.activeElement;
    const isOnStaticStart = active === dialog || active === headingRef.current;

    if (event.shiftKey && (active === first || isOnStaticStart)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={introId}
      // Implicit for showModal(), stated explicitly for static checkers.
      aria-modal="true"
      className="m-auto w-full max-w-lg rounded-2xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50"
      onClose={onClose}
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        // A click on ::backdrop is delivered to the <dialog> element itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
        <div>
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
            Terms and Conditions
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">Last updated: March 2026</p>
        </div>
        <button
          type="button"
          aria-label="Close"
          className={`-mr-2 -mt-1 cursor-pointer rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 ${FOCUS_RING}`}
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>

      {/* Scrollable content must be keyboard-scrollable: tabIndex + a named region. */}
      <div
        role="region"
        aria-label="Terms text"
        tabIndex={0}
        className={`max-h-72 space-y-4 overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600 ${FOCUS_RING_INSET}`}
      >
        <TermsText introId={introId} />
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
        <button
          type="button"
          className={`cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 ${FOCUS_RING}`}
          onClick={onClose}
        >
          Decline
        </button>
        <button
          type="button"
          className={`cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 ${FOCUS_RING}`}
          onClick={onAgree}
        >
          I agree
        </button>
      </div>
    </dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Success state                                                               */
/* -------------------------------------------------------------------------- */

function SuccessCard({ name, email }: { name: string; email: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The submit button just unmounted; move focus so the result is announced.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <PageShell>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <CheckIcon className="h-6 w-6 text-green-600" />
      </div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-center text-2xl font-semibold tracking-tight outline-none"
      >
        Welcome aboard, {name}!
      </h1>
      <p className="mt-2 text-center text-sm text-slate-500">
        We&apos;ve sent a confirmation link to {email}.
      </p>
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function GoodSignup() {
  const baseId = useId();
  const ids = {
    fullName: `${baseId}-full-name`,
    email: `${baseId}-email`,
    password: `${baseId}-password`,
    country: `${baseId}-country`,
    countryLabel: `${baseId}-country-label`,
    acceptedTerms: `${baseId}-terms`,
    termsLabel: `${baseId}-terms-label`,
  } as const;
  const errorId = (field: keyof FormValues) => `${baseId}-${field}-error`;

  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const fieldRefs = useRef<Partial<Record<keyof FormValues, HTMLElement | null>>>({});
  const termsButtonRef = useRef<HTMLButtonElement>(null);

  const registerField = (field: keyof FormValues) => (element: HTMLElement | null) => {
    fieldRefs.current[field] = element;
  };

  const updateField = <K extends keyof FormValues>(field: K, fieldValue: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: fieldValue }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const describedBy = (field: keyof FormValues) => (errors[field] ? errorId(field) : undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validate(values);
    setErrors(nextErrors);

    const firstInvalid = FIELD_ORDER.find((field) => nextErrors[field]);
    if (firstInvalid) {
      // Send keyboard and screen-reader users straight to the problem.
      fieldRefs.current[firstInvalid]?.focus();
      return;
    }

    setIsSubmitted(true);
  };

  const closeTerms = () => {
    setIsTermsOpen(false);
    // Native <dialog> restores focus too; being explicit keeps it deterministic.
    termsButtonRef.current?.focus();
  };

  const agreeToTerms = () => {
    updateField('acceptedTerms', true);
    closeTerms();
  };

  if (isSubmitted) return <SuccessCard name={values.fullName} email={values.email} />;

  return (
    <PageShell>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-slate-500">
        Start your 14-day free trial. No credit card required.
      </p>

      {/* noValidate: we render our own, screen-reader-friendly errors. */}
      <form className="mt-8 space-y-5" noValidate onSubmit={handleSubmit}>
        <div>
          <label htmlFor={ids.fullName} className="sr-only">
            Full name
          </label>
          <input
            ref={registerField('fullName')}
            id={ids.fullName}
            name="fullName"
            type="text"
            autoComplete="name"
            required
            placeholder="Full name"
            value={values.fullName}
            onChange={(event) => updateField('fullName', event.target.value)}
            aria-invalid={Boolean(errors.fullName)}
            aria-describedby={describedBy('fullName')}
            className={inputClassName(Boolean(errors.fullName))}
          />
          {errors.fullName && <ErrorText id={errorId('fullName')}>{errors.fullName}</ErrorText>}
        </div>

        <div>
          <label htmlFor={ids.email} className="sr-only">
            Email address
          </label>
          <input
            ref={registerField('email')}
            id={ids.email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={values.email}
            onChange={(event) => updateField('email', event.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy('email')}
            className={inputClassName(Boolean(errors.email))}
          />
          {errors.email && <ErrorText id={errorId('email')}>{errors.email}</ErrorText>}
        </div>

        <div>
          <label htmlFor={ids.password} className="sr-only">
            Password
          </label>
          <div className="relative">
            <input
              ref={registerField('password')}
              id={ids.password}
              name="password"
              type={isPasswordVisible ? 'text' : 'password'}
              autoComplete="new-password"
              required
              placeholder="••••••••"
              value={values.password}
              onChange={(event) => updateField('password', event.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={describedBy('password')}
              className={`${inputClassName(Boolean(errors.password))} pr-16`}
            />
            <button
              type="button"
              aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
              aria-controls={ids.password}
              className={`absolute inset-y-1 right-1 flex cursor-pointer items-center rounded-md px-2.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 ${FOCUS_RING}`}
              onClick={() => setIsPasswordVisible((visible) => !visible)}
            >
              {isPasswordVisible ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.password && <ErrorText id={errorId('password')}>{errors.password}</ErrorText>}
        </div>

        <div>
          <span id={ids.countryLabel} className="sr-only">
            Country
          </span>
          <CountryCombobox
            id={ids.country}
            labelId={ids.countryLabel}
            triggerRef={registerField('country')}
            value={values.country}
            onChange={(country) => updateField('country', country)}
            hasError={Boolean(errors.country)}
            describedBy={describedBy('country')}
          />
          {errors.country && <ErrorText id={errorId('country')}>{errors.country}</ErrorText>}
        </div>

        <div>
          <div className="flex items-start gap-3">
            {/*
              Real checkbox, visually hidden; the sibling <label> draws the box and
              carries the focus ring via `peer-focus-visible`. aria-labelledby
              gives the input the full name "I agree to the Terms and Conditions".
            */}
            <div className="relative mt-0.5 h-4 w-4 shrink-0">
              <input
                ref={registerField('acceptedTerms')}
                id={ids.acceptedTerms}
                name="acceptedTerms"
                type="checkbox"
                required
                className="peer sr-only"
                checked={values.acceptedTerms}
                onChange={(event) => updateField('acceptedTerms', event.target.checked)}
                aria-labelledby={ids.termsLabel}
                aria-invalid={Boolean(errors.acceptedTerms)}
                aria-describedby={describedBy('acceptedTerms')}
              />
              <label
                htmlFor={ids.acceptedTerms}
                className={`flex h-4 w-4 cursor-pointer items-center justify-center rounded border ${
                  values.acceptedTerms
                    ? 'border-indigo-600 bg-indigo-600'
                    : 'border-slate-300 bg-white'
                } peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-600`}
              >
                {values.acceptedTerms && <CheckIcon className="h-3 w-3 text-white" />}
              </label>
            </div>
            <span id={ids.termsLabel} className="text-sm text-slate-600">
              <label htmlFor={ids.acceptedTerms}>I agree to the</label>{' '}
              <button
                ref={termsButtonRef}
                type="button"
                aria-haspopup="dialog"
                className={`rounded font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700 ${FOCUS_RING}`}
                onClick={() => setIsTermsOpen(true)}
              >
                Terms and Conditions
              </button>
            </span>
          </div>
          {errors.acceptedTerms && (
            <ErrorText id={errorId('acceptedTerms')}>{errors.acceptedTerms}</ErrorText>
          )}
        </div>

        <button
          type="submit"
          className={`flex w-full cursor-pointer items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 ${FOCUS_RING}`}
        >
          Create account
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <a
          href="/login"
          className={`rounded font-medium text-indigo-600 hover:text-indigo-700 ${FOCUS_RING}`}
        >
          Sign in
        </a>
      </p>

      <TermsDialog isOpen={isTermsOpen} onClose={closeTerms} onAgree={agreeToTerms} />
    </PageShell>
  );
}
