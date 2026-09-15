import { useEffect } from 'react';
import BadSignup from '../bad-signup';
import GoodSignup from '../good-signup';

/**
 * Tiny path-based router so each fixture has a stable URL an agent can target:
 *   /bad  – inaccessible sign-up (see bad-signup.tsx for the trap map)
 *   /good – accessible sign-up
 */
export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  useEffect(() => {
    document.title =
      path === '/bad'
        ? 'Sign up (inaccessible fixture)'
        : path === '/good'
          ? 'Sign up (accessible fixture)'
          : 'Sign-up accessibility fixtures';
  }, [path]);

  if (path === '/bad') return <BadSignup />;
  if (path === '/good') return <GoodSignup />;

  return <Index />;
}

const LINK_CLASS =
  'rounded font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';

function Index() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-900/5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign-up accessibility fixtures</h1>
        <p className="mt-1 text-sm text-slate-500">
          Two visually identical registration flows for testing keyboard-only and screen-reader
          agents.
        </p>
        <ul className="mt-8 space-y-3 text-sm">
          <li>
            <a href="/bad" className={LINK_CLASS}>
              /bad
            </a>{' '}
            — inaccessible version, full of behavioural traps
          </li>
          <li>
            <a href="/good" className={LINK_CLASS}>
              /good
            </a>{' '}
            — accessible version, same visuals
          </li>
        </ul>
      </div>
    </main>
  );
}
