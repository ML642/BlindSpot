param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$Project,
  [ValidatePattern('^[a-z]+-[a-z]+[0-9]+$')][string]$Region = 'europe-central2',
  [string]$Model = 'gemini-2.5-flash'
)
$ErrorActionPreference = 'Stop'
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud failed ($LASTEXITCODE)" } }
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskBucket = "$Project-blindspot"
$taskImage = "$Region-docker.pkg.dev/$Project/blindspot/app:latest"
$apiAccount = "blindspot-api@$Project.iam.gserviceaccount.com"
$workerAccount = "blindspot-worker@$Project.iam.gserviceaccount.com"

# The secret must be created/populated separately; its value never appears in CLI args.
Invoke-Gcloud secrets versions describe latest --secret=blindspot-gemini --project=$Project
Invoke-Gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com secretmanager.googleapis.com --project=$Project
& gcloud artifacts repositories describe blindspot --location=$Region --project=$Project 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Invoke-Gcloud artifacts repositories create blindspot --repository-format=docker --location=$Region --project=$Project }
& gcloud storage buckets describe "gs://$taskBucket" --project=$Project 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Invoke-Gcloud storage buckets create "gs://$taskBucket" --location=$Region --uniform-bucket-level-access --public-access-prevention --project=$Project }
foreach ($accountName in @('blindspot-api', 'blindspot-worker')) {
  & gcloud iam service-accounts describe "$accountName@$Project.iam.gserviceaccount.com" --project=$Project 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Invoke-Gcloud iam service-accounts create $accountName --project=$Project }
}
foreach ($account in @($apiAccount, $workerAccount)) {
  Invoke-Gcloud storage buckets add-iam-policy-binding "gs://$taskBucket" --member="serviceAccount:$account" --role=roles/storage.objectUser
  Invoke-Gcloud secrets add-iam-policy-binding blindspot-gemini --member="serviceAccount:$account" --role=roles/secretmanager.secretAccessor --project=$Project
}
Invoke-Gcloud builds submit $taskRoot --tag=$taskImage --project=$Project
$commonEnv = "BLINDSPOT_EXECUTION_MODE=gcp,GCP_PROJECT=$Project,GCP_REGION=$Region,GCP_JOB_NAME=blindspot-worker,GCS_BUCKET=$taskBucket,GEMINI_MODEL=$Model"
Invoke-Gcloud run jobs deploy blindspot-worker --image=$taskImage --region=$Region --project=$Project --service-account=$workerAccount --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=660s --cpu=2 --memory=4Gi --command=node --args=--import,tsx,apps/server/src/worker-entry.ts --set-env-vars=$commonEnv --set-secrets=GEMINI_API_KEY=blindspot-gemini:latest
# Required specifically for jobs.run with the audit-id environment override.
Invoke-Gcloud run jobs add-iam-policy-binding blindspot-worker --region=$Region --project=$Project --member="serviceAccount:$apiAccount" --role=roles/run.jobsExecutorWithOverrides
Invoke-Gcloud run deploy blindspot --image=$taskImage --region=$Region --project=$Project --service-account=$apiAccount --allow-unauthenticated --cpu=1 --memory=2Gi --max=1 --concurrency=16 --timeout=120s --set-env-vars=$commonEnv --set-secrets=GEMINI_API_KEY=blindspot-gemini:latest
Invoke-Gcloud run services describe blindspot --region=$Region --project=$Project --format='value(status.url)'
