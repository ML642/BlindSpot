import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Audit, Finding } from '@blindspot/shared';
import { buildMarkdown, findingLocation } from '../apps/web/src/lib/format.js';

const finding: Finding = { id: 'finding', pageStateId: 'login-modal', title: 'Unnamed button', description: 'Missing name', impact: 'Cannot identify action', severity: 'serious', status: 'fail', method: 'tool', profileIds: ['blindness'], evidence: [], reproduction: ['Open login'], recommendation: 'Add a name', wcag: [], selector: '#submit' };
const audit: Audit = { id: 'audit', request: { url: 'https://example.com', scenario: 'Open login', profileIds: ['blindness'] }, status: 'completed', createdAt: '2026-09-15T12:00:00Z', updatedAt: '2026-09-15T12:00:00Z', progress: { phase: 'completed', completedProfiles: 1, totalProfiles: 1 }, pageStates: [
  { id: 'home', url: 'https://example.com', title: 'Home', capturedAt: '2026-09-15T12:00:00Z', domArtifactId: 'home-dom', accessibilityArtifactId: 'home-aria', screenshotArtifactId: 'home-image' },
  { id: 'login-modal', url: 'https://example.com/account?view=login', title: 'Login', capturedAt: '2026-09-15T12:00:01Z', domArtifactId: 'login-dom', accessibilityArtifactId: 'login-aria', screenshotArtifactId: 'login-image' },
], report: { summary: 'Audit done', scenarioOutcome: 'completed', profiles: [], findings: [finding], limitations: [] } };

test('finding uses its exact page state, not the starting URL or first screenshot', () => {
  const location = findingLocation(audit, finding, 'https://audit.example');
  assert.equal(location.pageUrl, 'https://example.com/account?view=login');
  assert.equal(location.screenshotUrl, 'https://audit.example/api/audits/audit/artifacts/login-image');
  const markdown = buildMarkdown(audit, 'https://audit.example');
  assert.match(markdown, /\[Affected page\]\(<https:\/\/example.com\/account\?view=login>\)/);
  assert.match(markdown, /https:\/\/audit.example\/api\/audits\/audit\/artifacts\/login-image/);
  assert.ok(markdown.indexOf('### Unnamed button') < markdown.indexOf('#### Issue location'));
});

test('missing evidence and unsafe legacy URLs do not produce incorrect links', () => {
  assert.equal(findingLocation(audit, { ...finding, pageStateId: 'missing' }).screenshotUrl, undefined);
  const altered = structuredClone(audit);
  altered.pageStates[1].screenshotArtifactId = undefined;
  altered.pageStates[1].url = 'javascript:alert(1)';
  const location = findingLocation(altered, finding);
  assert.equal(location.pageUrl, undefined);
  assert.equal(location.screenshotUrl, undefined);
  assert.match(buildMarkdown(altered), /Screenshot unavailable/);
});
