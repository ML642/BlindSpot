# BlindSpot

An agent-assisted accessibility audit for real user journeys. Enter a public URL, describe a scenario, and choose from 18 accessibility profiles. A Gemini navigation agent explores rendered pages in Chromium; specialist playbooks combine measured browser checks with evidence-based review.

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

`test:ui` checks the built app at desktop and mobile sizes, sample-report navigation, filters, export, and axe diagnostics. The sample runs real browser checks on a generated illustrative page, without Gemini.

Live Gemini 3.8 Flash has been verified with a complete local one-profile audit of example.com. Individual results still require review; this smoke test is not a guarantee of correctness on arbitrary sites. The dependency audit currently reports two moderate transitive alerts (`gaxios` / `uuid`); resolve these before exposing the service beyond a controlled hackathon demo.

## What an audit does

1. Validates the URL and creates a bounded job.
2. Starts a separate browser worker and captures the initial rendered page.
3. Lets Gemini choose from a fixed set of browser tools to follow the requested journey.
4. Collects screenshots, rendered DOM, accessibility snapshots, and diagnostic results for visited states, including same-URL dialogs and SPA changes.
5. Runs selected profile playbooks, merges duplicate findings, and produces a report with inspectable evidence and remediation guidance.

The MVP explores public interfaces. A login scenario ends at the form, including keyboard access and empty-field validation. It does not supply account credentials, complete authentication, bypass CAPTCHAs, make purchases, or perform account-changing actions.

## Understanding the results

Each check is `pass`, `fail`, `needs_review`, `not_applicable`, or `blocked`. Findings distinguish deterministic measurements (`tool`) from model judgement (`gemini`). A completed job means the audit process finished, not that the page conforms to WCAG.

Automation cannot establish full accessibility. Caption presence does not establish caption accuracy; a DOM accessibility snapshot is not a screen-reader test; viewport reflow is not full browser zoom; motion detection is not certified flash-frequency analysis. The report retains these limitations and human-review tasks.

Cloudflare challenge responses (`cf-mitigated: challenge`), recognizable Cloudflare verification interstitials, and main-page HTTP 403/429 stop the audit with a blocked scenario and preserved page evidence. These pages are not passed to accessibility checkers or Gemini specialists as if they were the requested site. Detection is conservative: simply embedding Turnstile or mentioning Cloudflare does not trigger a block. Existing time, action, page-state and model-turn limits remain the fallback for unrecognized stalls. BlindSpot does not solve challenges or impersonate verified bots; ask the site owner to authorize access or provide a staging environment. See [Cloudflare challenge detection](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) and [verified bot authentication](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/).

Profiles cover vision, hearing, movement, speech, cognition, learning, attention, memory, sensory sensitivities, photosensitivity, motion sensitivity, temporary impairments, and situational limitations. Playbooks live in `packages/playbooks` and map applicable checks to [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

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
