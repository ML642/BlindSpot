export async function launchLocalBrowser(): Promise<never> {
  throw new Error('Cloudflare audits require the remote Browser Run binding.');
}
