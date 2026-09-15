import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlaybookResult } from '@blindspot/shared';
import { combinePlaybookResults, type LiveResult } from '../apps/server/src/playbook-adapter.js';

function result(checks: PlaybookResult['checks']): LiveResult {
  return { findings: [], profiles: [{ profileId: 'vestibular', status: 'blocked', summary: '', checks }] };
}

test('repeated profile checks from multiple page states are merged with their evidence', () => {
  const output = combinePlaybookResults([
    result([
      { id: 'motion-state-1', title: 'Motion and reduced motion', status: 'needs_review', method: 'tool', evidenceIds: ['motion-evidence-1'], notes: 'Visible elements use CSS animation, transition or smooth scrolling.' },
      { id: 'state-1-unavailable-checks', title: 'axe execution', status: 'blocked', method: 'tool', evidenceIds: [], notes: 'axe could not inspect this state.' },
    ]),
    result([
      { id: 'motion-state-2', title: 'Motion and reduced motion', status: 'needs_review', method: 'tool', evidenceIds: ['motion-evidence-2'], notes: 'Visible elements use CSS animation, transition or smooth scrolling.' },
      { id: 'state-2-unavailable-checks', title: 'axe execution', status: 'blocked', method: 'tool', evidenceIds: [], notes: 'axe could not inspect this state.' },
    ]),
  ], ['vestibular']);

  const checks = output.profiles[0].checks;
  assert.equal(checks.length, 2);
  assert.deepEqual(
    checks.find(check => check.title === 'Motion and reduced motion')?.evidenceIds,
    ['motion-evidence-1', 'motion-evidence-2'],
  );
  assert.equal(checks.filter(check => check.title === 'axe execution').length, 1);
});

test('generic review placeholder is removed after specialist checks arrive', () => {
  const output = combinePlaybookResults([
    result([{ id: 'specialist-review', title: 'Scenario and assistive-technology review', status: 'needs_review', method: 'gemini', evidenceIds: [], notes: 'No deterministic failure was observed.' }]),
    result([{ id: 'specialist-motion', title: 'Motion review', status: 'not_applicable', method: 'gemini', evidenceIds: ['specialist-evidence'], notes: 'No motion is present.' }]),
  ], ['vestibular']);

  assert.deepEqual(output.profiles[0].checks.map(check => check.id), ['specialist-motion']);
});
