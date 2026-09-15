# BlindSpot

An agent-assisted accessibility audit for real user journeys. Enter a public URL, describe a scenario, and choose from seven accessibility profiles. Each profile fixes a **perspective**: how the navigation agent operates the page and which evidence its specialist may see. The blind profile only ever hears a screen reader; the low-vision profile sees simulated renderings, measured contrast and the code.

## Local development

Requires Node.js 22 or newer. Docker is optional for local development.

```sh
npm install
npm run browser:install
```

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` and `GEMINI_MODEL`. Never put a key in a `VITE_` variable or frontend source. Then:

```sh
npm run dev
```

Open http://localhost:5173. The frontend proxies `/api` to the local server. Without Gemini credentials, use **Explore sample report** to inspect an explicitly labelled sample; it is not an audit of the URL entered in the form.

```sh
npm run typecheck
npm test
npm run build
npm run test:ui
npm start
```

`test:ui` checks the built app at desktop and mobile sizes, sample-report navigation, filters, export, and axe diagnostics. The sample runs real browser checks on a generated illustrative page, without Gemini. `npm test` includes a screen-reader journey test that reads a login fixture through speech alone, opens its dialog, and verifies that credential entry and login submission stay blocked.

Live Gemini 3.8 Flash has been verified with a complete local one-profile audit of example.com. Individual results still require review; this smoke test is not a guarantee of correctness on arbitrary sites. The dependency audit currently reports two moderate transitive alerts (`gaxios` / `uuid`); resolve these before exposing the service beyond a controlled hackathon demo.

## What an audit does

1. Validates the URL and creates a bounded job.
2. Groups the selected profiles into journeys by interaction mode and opens one Chromium context per journey:
   - **Screen reader** (blindness): a virtual screen reader ([`@guidepup/virtual-screen-reader`](https://github.com/guidepup/virtual-screen-reader)) is injected into the page. The Gemini agent gets only what it speaks and navigates with reader commands: read next, jump to heading or landmark, elements list, activate, type, key press. No screenshot, HTML, selector or rule output ever reaches it.
   - **Keyboard only** (motor): the agent sees a screenshot and the focused element and may only press keys.
   - **Sighted pointer** (low vision, colour vision, hearing, cognition, motion): the agent sees a screenshot and a numbered list of visible controls described by their labels.
3. Every captured state stores the full evidence: screenshot, DOM, accessibility tree, axe results, DOM signals, the screen-reader read-through, the keyboard focus trace, and per-profile renderings (blurred vision, reduced contrast, protanopia, deuteranopia, tritanopia, achromatopsia, 320px reflow, 200% text size).
4. Deterministic checks run on each state for the journey's profiles, with `pass`, `fail`, `needs_review` or `not_applicable` results.
5. One Gemini specialist per profile receives only the channels of its perspective plus the transcript of its journey, and returns review candidates that must cite supplied evidence. Findings are merged into a report with inspectable evidence, journey transcripts and remediation guidance.

The MVP explores public interfaces. A login scenario ends at the form, including keyboard access and empty-field validation. It does not supply account credentials, complete authentication, bypass CAPTCHAs, make purchases, or perform account-changing actions.

## Understanding the results

Each check is `pass`, `fail`, `needs_review`, `not_applicable`, or `blocked`. Findings distinguish deterministic measurements (`tool`) from model judgement (`gemini`). A completed job means the audit process finished, not that the page conforms to WCAG.

Automation cannot establish full accessibility. Caption presence does not establish caption accuracy; the virtual screen reader follows the ARIA specification but is not NVDA, JAWS or VoiceOver; viewport reflow is not full browser zoom; vision-deficiency emulation is Chromium's approximation; motion detection is not certified flash-frequency analysis. The report retains these limitations and human-review tasks.

## Profiles and perspectives

| Profile | Journey | Specialist evidence |
| --- | --- | --- |
| Blindness | Screen reader | Speech log of each state and the screen-reader transcript. Nothing visual, no code. |
| Low vision | Sighted pointer | Screenshots, blurred and reduced-contrast renderings, 320px and 200%-text renderings, measured contrast, DOM, axe. |
| Color vision deficiency | Sighted pointer | Screenshots with protanopia, deuteranopia, tritanopia and achromatopsia renderings, measured contrast, DOM, axe. |
| Deaf and hard of hearing | Sighted pointer | Screenshots, visible text, media inventory (tracks, autoplay, controls), DOM. |
| Motor and dexterity | Keyboard only | Screenshots, Tab focus trace with focus-indicator measurements, target sizes, DOM, axe, keyboard transcript. |
| Cognitive, learning and attention | Sighted pointer | Screenshots and visible text only, as a sighted person without code access. |
| Motion and flashing sensitivity | Sighted pointer | Screenshots, running-animation inventory, reduced-motion measurements, DOM. |

Earlier profiles that duplicated one of these perspectives (hard of hearing, paralysis, tremors, dyslexia, ADHD, memory, autism, photosensitivity, vestibular, temporary, situational) were folded into them; speech impairment was removed because public web pages rarely require speech input and the check produced no actionable evidence. Perspectives live in `packages/playbooks/src/perspectives.ts`; playbooks in `packages/playbooks/src/playbooks.ts` map checks to [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and `npm run docs:playbooks` regenerates their documentation.

## Architecture

| Component | Responsibility |
| --- | --- |
| `apps/web` | Accessible React interface, live progress, evidence viewer, report export |
| `apps/server` | Fastify API, job storage, worker lifecycle, Gemini and browser tools |
| `packages/shared` | Request validation and shared audit/report types |
| `packages/playbooks` | Profile knowledge, diagnostics, aggregation |
| `fixtures` | Broken and corrected test interfaces; never production target allowlists |
| `infrastructure` | GCP deployment configuration |

Local jobs use child processes and local files. GCP uses a Cloud Run service for the API and built frontend, a Cloud Run Job for each browser audit, and a private Cloud Storage bucket for persisted results and artifacts. Credentials are server-side. This repository does not deploy automatically during installation.

## API

- `POST /api/audits` — `{ url, scenario, profileIds }` → `202 { id }`
- `GET /api/audits/:id` — current audit and available report
- `GET /api/audits/:id/events?after=0` — incremental `{ events }`
- `POST /api/audits/:id/cancel` — request cancellation
- `GET /api/audits/:id/artifacts/:artifactId` — evidence download
- `GET /api/health` — configuration readiness, without secrets
- `POST /api/demo` — explicitly labelled sample report

Audit links are bearer links in this no-login hackathon MVP: anyone with the identifier can retrieve that report. Do not audit private data or enter secrets in scenarios. Browser destinations are restricted to public HTTP(S) endpoints; redirects and subresources are subject to the same network rules. Rate, concurrency, page, action and duration limits bound the work.

## Contributing a playbook

Keep rules tied to observable evidence. Reference the relevant W3C success criterion and distinguish normative requirements from good practice. An unsupported or unexecuted test must remain `needs_review` or `blocked`; do not manufacture a passing result from missing evidence.
