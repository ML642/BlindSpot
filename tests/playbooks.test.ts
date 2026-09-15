import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { getPlaybooks, runAutomatedChecks, aggregateFindings, journeyModes, profilesForMode, renderingsFor } from '@blindspot/playbooks';
import { profileIds } from '@blindspot/shared';

test('every profile has a perspective, an executable catalog and a documented playbook', async () => {
  const catalog = getPlaybooks(); assert.equal(catalog.length, profileIds.length);
  assert.deepEqual(new Set(catalog.map(p => p.id)), new Set(profileIds));
  for (const profile of catalog) {
    assert.ok(profile.checks.length > 0);
    assert.ok(profile.perspective.channels.length > 0);
    assert.match(profile.prompt, /Perspective:/);
    assert.match(await fs.readFile(new URL(`../packages/playbooks/playbooks/${profile.id}.md`, import.meta.url), 'utf8'), /Result policy/);
    for (const ref of profile.wcag) assert.match(ref.url, /^https:\/\/www\.w3\.org\//);
  }
  // The blind specialist must never receive visual or code evidence.
  const blind = getPlaybooks(['blindness'])[0].perspective;
  assert.equal(blind.interaction, 'screen-reader');
  assert.deepEqual(blind.channels.filter(channel => ['screenshot', 'dom', 'axe', 'simulation', 'accessibility-tree'].includes(channel)), []);
  assert.deepEqual(journeyModes(['blindness', 'low-vision', 'motor', 'cognitive']), ['screen-reader', 'keyboard', 'pointer']);
  assert.deepEqual(profilesForMode(['blindness', 'low-vision', 'cognitive'], 'pointer'), ['low-vision', 'cognitive']);
  assert.ok(renderingsFor(['color-vision']).includes('deuteranopia'));
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
      return runAutomatedChecks({ page, pageState: { id: name, url: 'about:blank', title: name, description: name, journey: 'pointer', capturedAt: new Date().toISOString() }, axeResults: { violations: axe.violations.map(r => ({ ...r, nodes: r.nodes.map(n => ({ ...n, target: n.target.map(String) })) })) } });
    };
    const broken = await run('broken'); const fixed = await run('fixed');
    assert.ok(broken.findings.some(f => f.selector === '.tiny' && f.wcag.some(ref => ref.id === '4.1.2') && f.status === 'fail'));
    assert.ok(!fixed.findings.some(f => f.wcag.some(ref => ref.id === '4.1.2') && f.status === 'fail'));
    assert.ok(broken.findings.some(f => /target|motion|heading/i.test(f.title) && f.status === 'needs_review'));
    assert.ok(broken.evidence.some(e => e.description.includes('320px')));
    assert.ok(broken.findings.some(f => /Animated content needs motion review/.test(f.title) && f.profileIds.includes('motion')), 'the running 2s ticker must be inventoried as a running animation');
    assert.ok(!broken.findings.some(f => /flash candidate/i.test(f.title)), 'a 2s cycle is not a flash candidate');
    assert.ok(broken.findings.some(f => /focus indicator|Focused control shows no visible/i.test(f.title)) || broken.evidence.some(e => e.type === 'focus'), 'the Tab probe records a focus trace');
    const merged = aggregateFindings([broken.findings[0], { ...broken.findings[0], id: 'duplicate', profileIds: ['motion'] }]);
    assert.equal(merged.length, 1); assert.ok(merged[0].profileIds.includes('motion'));
  } finally { await browser.close(); }
});
