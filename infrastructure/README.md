# GCP deployment

The deployment script creates a public Cloud Run service, a private bucket, two service accounts, an Artifact Registry repository and a Cloud Run Job. Run it only in the intended, billing-enabled project. It does not create a VM per audit: each audit gets a separate Cloud Run Job execution, capped at 11 minutes with retries disabled.

## Prerequisites

Install and authenticate the Google Cloud CLI. The deploying account needs permissions to enable APIs, build containers, manage Cloud Run, service accounts, storage and IAM. Enable Secret Manager and create a secret named `blindspot-gemini` in the project. Add your Gemini key as a secret version through the Google Cloud console; do not put its value in shell command arguments.

```powershell
./infrastructure/deploy.ps1 -Project your-project-id
```

Set `-Region` or `-Model` when needed. The script checks the secret, builds from the repository root, deploys the worker and service, grants bucket access and permission to start that job with an audit-id override, then prints the URL. Only the audit ID is sent in an execution override. The worker loads the request from the bucket and its key from Secret Manager.
Use `-GeminiSecret GEMINI_API_KEY` if your existing secret has that name instead of `blindspot-gemini`. The default model is `gemini-3.8-flash`. `.gcloudignore` excludes local credentials and audit data from uploaded build sources.

The API is limited to one instance for the hackathon admission limiter. GCP allows 15 active audits by default, configurable with `BLINDSPOT_MAX_CONCURRENT_AUDITS`. Local development defaults to two. The POST limit per IP per minute is twice the audit limit, with a minimum of ten. Each audit runs a separate worker execution with 4 vCPU/8 GiB. The API has 1 vCPU/2 GiB because the sample report renders a local browser. Keep maximum instances at one until admission/rate limits use a shared transactional store. There is no user authentication. Report IDs act as bearer links. GCP and Gemini quotas still apply independently of these application limits.

## Verification

Open `/api/health`, generate a sample report, then run a live audit on a public site you control. Confirm progress, screenshots, a final report, and cancellation. Inspect Cloud Run execution status and logs for startup or provider errors.

Verified on 2026-09-15: Cloud Build container compilation, public Cloud Run UI/API, a separate Cloud Run Job completing a live Gemini 3.8 Flash one-profile audit of example.com, persisted report and downloadable PNG evidence, and sample-report generation. The build's first submission briefly returned permission denied after API enablement; retrying with unchanged credentials succeeded. Local regression tests cover cancellation; verify it separately after each cloud deployment.

Artifacts remain private in Cloud Storage and are exposed through the API by report ID. Set a bucket lifecycle deletion policy (for example seven days) appropriate to your hackathon. Public POST access can consume Gemini/GCP quota; use a project budget alert and close public access when the event ends.

Sources: [browser automation on Cloud Run](https://docs.cloud.google.com/run/docs/browser-automation), [executing jobs with overrides](https://docs.cloud.google.com/run/docs/execute/jobs), [Cloud Run IAM roles](https://docs.cloud.google.com/run/docs/reference/iam/roles).
