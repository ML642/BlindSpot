import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingDisposition, type Finding } from '@blindspot/shared';
import { aggregateFindings } from '@blindspot/playbooks';

const base: Finding = { id: 'a', title: 'Issue', description: 'Description', impact: 'Impact', severity: 'serious', profileIds: ['blindness'], pageStateId: 'page', selector: '#field[1]', evidence: [{ id: 'e', type: 'dom', description: 'Recorded condition' }], reproduction: ['Inspect'], recommendation: 'Fix', wcag: [], method: 'tool', status: 'fail' };
test('certainty, suggestions and impact remain independent', () => {
  assert.equal(findingDisposition(base), 'confirmed');
  assert.equal(findingDisposition({ ...base, evidence: [] }), 'unverified');
  assert.equal(findingDisposition({ ...base, method: 'gemini', status: 'needs_review' }), 'unverified');
  assert.equal(findingDisposition({ ...base, method: 'gemini', status: 'needs_review', observation: 'The visible button has no text label.' }), 'review');
  assert.equal(findingDisposition({ ...base, status: 'needs_review', disposition: 'suggestion' }), 'suggestion');
  assert.equal(findingDisposition({ ...base, status: 'needs_review', title: 'Heading hierarchy skips a level' }), 'suggestion');
  assert.equal(findingDisposition({ ...base, status: 'needs_review', title: 'Animated content needs motion review' }), 'unverified');
});
test('dedup retains distinct indexed and case-sensitive selectors', () => {
  const merged = aggregateFindings([base, { ...base, id: 'b', profileIds: ['motor'] }]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].profileIds, ['blindness', 'motor']);
  assert.equal(aggregateFindings([base, { ...base, selector: '#field[2]' }, { ...base, selector: '#Field[1]' }]).length, 3);
});
