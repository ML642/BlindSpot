# Cloudflare free demo

The Cloudflare build serves the React app and a prebuilt sample report through Workers Static Assets. A small Worker routes live audits to SQLite Durable Objects. Browser Run provides Chromium; Gemini uses your API key stored as a Worker secret. Docker, an Oracle server, R2 and a Workers Paid subscription are not required.

The demo shares four live audit attempts per rolling 24 hours across all visitors. Each audit uses one profile, at most four actions, two page states, three navigation model turns and two minutes of wall time. A 150-second reservation prevents overlapping audits and browser launch bursts. Failed and cancelled attempts also consume a slot. Reports and evidence expire after 24 hours. The static sample consumes no browser or Gemini quota.

Cloudflare currently includes 10 Browser Run minutes per day on Workers Free. Other applications and development tests on the same account share that allowance. Gemini has separate project/model quotas. These application limits reserve headroom; they do not increase either provider's allowance. See [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Deploy

Use Node 22 or newer. From the repository root:

```sh
npm ci
npx playwright install chromium --only-shell
npm run build:cloudflare
npm run check:cloudflare
npx wrangler login --scopes user:read account:read workers:write workers_scripts:write browser:write
npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY
```

Enter the key at the secret prompt. Never put it in `wrangler.jsonc`, frontend variables or git. Without the secret, live audits are disabled and the sample remains usable. Set `GEMINI_MODEL` in `wrangler.jsonc` to a model available to the key's project, then redeploy if needed. The default matches the existing server configuration.

The first deploy creates the two SQLite Durable Object namespaces via migration `v1`. Keep that migration after deployment. Use the generated `workers.dev` URL, or configure a custom domain separately. Do not enable a paid plan for this demo.

For subsequent releases use `npm run deploy:cloudflare`. The existing Node/Fastify deployment still uses the original `npm run build` and `npm start` commands.

## Verify and develop

```sh
npm test
npm run typecheck
npm run build:cloudflare
npm run check:cloudflare
npm run test:cloudflare
```

The Cloudflare tests run the packaged Worker in Miniflare, including Durable Object alarms, request validation, concurrent quota reservations, cancellation, static evidence and a real browser audit. DNS, target content and Gemini responses are controlled fixtures. They do not use a real Gemini key.

If Miniflare's downloaded Chromium cannot start on your system, test against a real Browser Run binding after logging in. This consumes browser time from your Cloudflare account:

```powershell
$env:BLINDSPOT_REMOTE_BROWSER='1'
npm run test:cloudflare
```

For local development, copy `.dev.vars.example` to `.dev.vars`, add the key if live local audits are needed, build, then run `npm run dev:cloudflare`. Rebuild after editing source. Do not commit `.dev.vars`.

## Scope and retention

Audits visit public HTTP/HTTPS hostnames on default ports. Browser Run guardrails deny direct browser network access. Intercepted GET/HEAD/OPTIONS requests are validated and fulfilled through Workers' public network. Private addresses, cookies, state-changing requests, media streams and WebSockets are blocked. Authenticated sites and interfaces that depend on those features may produce partial reports. A partial result preserves captured evidence and explains limitations.

Evidence is stored in 64 KB chunks, with limits of 2 MB per artifact and 12 MB per audit. Screenshots capture the viewport. Audit IDs act as unlisted report links; anyone with the link can read the report until it expires. Use this public demo for public websites. For a longer or authenticated audit, use the original server deployment.

Alarms mark interrupted attempts as failed or partial instead of launching another browser after a crash. Browser sessions close before specialist model review and again in cleanup. Expiry alarms remove live reports. The static sample is generated from the local fixture at build time and is independent of live storage.
