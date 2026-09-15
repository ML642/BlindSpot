
export interface CloudRunJobOptions { project?: string; region?: string; jobName?: string; bucket?: string; }

/** Small adapter around the Cloud Run Jobs REST API. The worker image owns
 * browser execution; this process only submits an isolated job with a signed
 * audit id and shared storage configuration. */
export class CloudRunJobAdapter {
  constructor(private readonly options: CloudRunJobOptions) {}

  async launch(auditId: string): Promise<{ executionName?: string }> {
    const { project, region, jobName } = this.options;
    if (!project || !region || !jobName) throw new Error('GCP_PROJECT, GCP_REGION and GCP_JOB_NAME are required for GCP execution.');
    const authModuleName = 'google-auth-library';
    const { GoogleAuth } = await import(authModuleName);
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse.token;
    if (!token) throw new Error('Could not obtain a Google access token for the Cloud Run Job.');
    const endpoint = `https://run.googleapis.com/v2/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/jobs/${encodeURIComponent(jobName)}:run`;
    const response = await fetch(endpoint, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ overrides: { containerOverrides: [{ env: [
        { name: 'BLINDSPOT_AUDIT_ID', value: auditId },
        ...(this.options.bucket ? [{ name: 'GCS_BUCKET', value: this.options.bucket }] : []),
      ] }] } }),
    });
    if (!response.ok) throw new Error(`Cloud Run Job submission failed (${response.status}).`);
    const body = await response.json() as { name?: string };
    return { executionName: body.name };
  }
}
