import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { getPlaybooks, runAutomatedChecks, aggregateFindings } from '@blindspot/playbooks';
import { profileIds } from '@blindspot/shared';

test('all 18 profiles have an executable catalog and a documented playbook', async () => {
  const catalog = getPlaybooks(); assert.equal(catalog.length, 18);
  assert.deepEqual(new Set(catalog.map(p => p.id)), new Set(profileIds));
  for (const profile of catalog) {
    assert.ok(profile.checks.length > 0);
    assert.match(await fs.readFile(new URL(`../packages/playbooks/playbooks/${profile.id}.md`, import.meta.url), 'utf8'), /Result policy/);
    for (const ref of profile.wcag) assert.match(ref.url, /^https:\/\/www\.w3\.org\//);
  }
});

test('real checker distinguishes broken/corrected names and heuristic review from failures', { timeout: 45_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const run = async (name: string) => {
      await page.setContent(await fs.readFile(new URL(`../fixtures/${name}.html`, import.meta.url), 'utf8'));
      const axe = await new AxeBuilder({ page }).analyze();
      return runAutomatedChecks({ page, pageState: { id: name, url: 'about:blank', title: name, description: name, capturedAt: new Date().toISOString() }, axeResults: { violations: axe.violations.map(r => ({ ...r, nodes: r.nodes.map(n => ({ ...n, target: n.target.map(String) })) })), passes: axe.passes.map(r => ({ id: r.id, tags: r.tags, help: r.help, helpUrl: r.helpUrl, nodes: [] })) } });
    };
    const broken = await run('broken'); const fixed = await run('fixed');
    assert.ok(broken.findings.some(f => f.selector === '.tiny' && f.wcag.some(ref => ref.id === '4.1.2') && f.status === 'fail'));
    assert.ok(!fixed.findings.some(f => f.wcag.some(ref => ref.id === '4.1.2') && f.status === 'fail'));
    assert.ok(fixed.profiles.some(profile => profile.checks.some(check => check.status === 'pass')));
    assert.ok(broken.findings.some(f => /target|motion|heading/i.test(f.title) && f.status === 'needs_review'));
    assert.ok(broken.evidence.some(e => e.description.includes('320px')));
    const merged = aggregateFindings([broken.findings[0], { ...broken.findings[0], id: 'duplicate', profileIds: ['temporary'] }]);
    assert.equal(merged.length, 1); assert.ok(merged[0].profileIds.includes('temporary'));
  } finally { await browser.close(); }
});
