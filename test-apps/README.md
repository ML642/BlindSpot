# Sign-up accessibility fixtures

Two visually identical React + TypeScript + Tailwind registration flows for
evaluating agents that test web apps with a simulated screen reader and
keyboard-only navigation.

| Route   | File               | Purpose                                              |
| ------- | ------------------ | ---------------------------------------------------- |
| `/bad`  | `bad-signup.tsx`   | Looks fine, unusable without a mouse. Traps marked `// TRAP:`. |
| `/good` | `good-signup.tsx`  | Same visuals, fully keyboard and screen-reader operable. |

## Run

```bash
npm install
npx playwright install chromium   # once, only needed for the tests
npm run dev                       # http://localhost:5173  (/bad, /good)
```

## Test

```bash
npm test            # Playwright ground-truth spec, starts the dev server itself
npm run test:headed # same, with a visible browser
npm run typecheck
```

`tests/signup.spec.ts` encodes what an agent should find:

- `/bad`: Tab reaches only the three inputs and two links; the password
  toggle, country dropdown, terms checkbox and submit control are never
  focusable. Field names fall back to placeholders (`you@example.com`,
  `••••••••`). The dropdown ignores every key. Opening the Terms modal leaves
  focus on the trigger, the next Tab lands on the "Sign in" link behind the
  overlay, Escape does nothing. The flow cannot be completed keyboard-only.
- `/good`: every control is reachable in visual order and properly named, the
  combobox is operable with arrows / Home / End / Enter / Escape / type-ahead,
  the dialog traps focus and restores it on Escape, errors are linked via
  `aria-describedby`, and the whole flow completes keyboard-only.
- axe-core baseline: `/good` has zero violations. `/bad` triggers only three
  best-practice rules (`landmark-one-main`, `page-has-heading-one`, `region`)
  and **no WCAG-tagged violations** — static analysis misses every behavioural
  trap above.

## Manual keyboard script

1. Load `/bad`, press Tab repeatedly. Note which controls are skipped.
2. Tab to "Terms and Conditions", press Enter, press Tab again. Watch where
   focus goes. Press Escape.
3. Try to pick a country or tick the checkbox without the mouse.
4. Repeat on `/good`. In the dialog, Tab past the last button and Shift+Tab
   before the first one; press Escape and check where focus returns.
5. On `/good`, type a letter while the country combobox is focused.
