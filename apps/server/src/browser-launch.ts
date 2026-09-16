import { chromium } from 'playwright';
import { startNetworkProxy } from './network-proxy.js';

export async function launchLocalBrowser(fixtureTarget?: string) {
  const proxy = await startNetworkProxy({ fixtureTarget: fixtureTarget });
  try {
    const browser = await chromium.launch({ headless: true, proxy: proxy ? { server: proxy.url } : undefined,
      args: proxy ? ['--proxy-bypass-list=<-loopback>', '--disable-quic'] : undefined });
    return { browser, proxy };
  } catch (error) { await proxy?.close(); throw error; }
}
