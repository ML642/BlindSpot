import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { runAutomatedChecks } from '@blindspot/playbooks';
import type { Audit, PageState } from '@blindspot/shared';
import type { ArtifactStore } from './storage.js';

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fieldwork — sign in sample</title><style>
*{box-sizing:border-box}body{margin:0;background:#f0f4f8;color:#152538;font:17px Arial,sans-serif}header{padding:32px 48px;border-bottom:1px solid #d7e0e9;font-weight:700}main{margin:65px auto;background:white;padding:44px;width:440px;border:1px solid #d7e0e9}h1{font-size:32px;margin:0 0 16px}p{line-height:1.5}.hint{color:#aaa;font-size:14px}label{display:block;margin:24px 0 8px;font-size:14px;font-weight:bold}input{width:100%;padding:14px;border:1px solid #bdcbd9;font:inherit}button{background:#176ed4;color:white;border:0;margin-top:24px;padding:12px 28px;font-size:18px;cursor:pointer}.options{display:flex;justify-content:space-between;align-items:center}.help{color:#275585;font-size:14px}
</style></head><body><header>Fieldwork / sample interface</header><main><h1>Welcome back</h1><p>Sign in to your workspace.</p><form><label for="email">Email address</label><input id="email" type="email" autocomplete="email" required><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required><p class="hint">Use the email associated with your account.</p><div class="options"><button type="button"><span aria-hidden="true">→</span></button><a class="help" href="#help">Need help?</a></div></form></main></body></html>`;

export async function createSampleAudit(store: ArtifactStore): Promise<Audit> {
  const id = randomUUID(); const now = new Date().toISOString();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage(); await page.setContent(html);
    const screenshot = await store.put(id, 'sample.png', await page.screenshot(), 'image/png');
    const dom = await store.put(id, 'sample.html', html, 'text/plain');
    const aria = await store.put(id, 'sample.aria.txt', await page.locator('body').ariaSnapshot(), 'text/plain');
    const state: PageState = { id: randomUUID(), url: 'https://sample.blindspot.example/sign-in', title: 'Fieldwork sign-in sample', capturedAt: now, journey: 'pointer', description: 'Illustrative sign-in page, rendered locally', screenshotArtifactId: screenshot.id, domArtifactId: dom.id, accessibilityArtifactId: aria.id };
    const ids = ['blindness', 'low-vision', 'motor', 'cognitive'] as const;
    const axe = await new AxeBuilder({ page }).analyze();
    const result = await runAutomatedChecks({ page, pageState: state, axeResults: { violations: axe.violations.map(rule => ({ ...rule, nodes: rule.nodes.map(node => ({ ...node, target: node.target.map(String) })) })), passes: axe.passes.map(rule => ({ id: rule.id, tags: rule.tags, help: rule.help, helpUrl: rule.helpUrl, nodes: [] })) } }, ids);
    result.findings.forEach(finding => finding.evidence.push({ id: `${finding.id}-screenshot`, type: 'screenshot', artifactId: screenshot.id, description: 'Rendered sample page showing the affected UI.' }));
    const audit: Audit = { id, demo: true, createdAt: now, updatedAt: new Date().toISOString(), status: 'completed', request: { url: state.url, scenario: 'Inspect a sample sign-in form for accessible names, contrast, keyboard access and reflow.', profileIds: [...ids] }, progress: { phase: 'Sample report ready', completedProfiles: ids.length, totalProfiles: ids.length }, pageStates: [state], report: { summary: 'Sample report: actual browser checks on an illustrative sign-in interface. No supplied website or Gemini model was used.', scenarioOutcome: 'completed', findings: result.findings, profiles: result.profiles, evidence: result.evidence, limitations: ['This is an illustrative sample, not an audit of your URL.', 'Gemini specialists and perspective journeys were not run for this sample.', ...result.limitations], journeys: [] } };
    await store.saveAudit(audit); await store.saveEvents?.(id, [{ id: 1, timestamp: now, type: 'status', message: 'Illustrative sample report generated without a Gemini call.' }]);
    return audit;
  } finally { await browser.close(); }
}
