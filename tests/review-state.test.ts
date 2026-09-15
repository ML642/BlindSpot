import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewMarks, updateReviewMark, reviewKey, reviewRank } from '../apps/web/src/lib/review-state.js';

test('manual review parsing accepts only supported marks', () => {
  assert.deepEqual(parseReviewMarks(null), {});
  assert.deepEqual(parseReviewMarks('{"a":"seen","b":"resolved","c":"pass","d":null}'), { a: 'seen', b: 'resolved' });
  assert.throws(() => parseReviewMarks('broken'));
  assert.throws(() => parseReviewMarks('[]'));
  assert.notEqual(reviewKey('first'), reviewKey('second'));
});
test('marking and reopening are immutable and order untouched findings first', () => {
  const initial = { a: 'seen' as const };
  const next = updateReviewMark(initial, 'a', 'resolved');
  assert.deepEqual(initial, { a: 'seen' });
  assert.deepEqual(next, { a: 'resolved' });
  assert.deepEqual(updateReviewMark(next, 'a', 'open'), {});
  assert.deepEqual(['resolved', 'open', 'seen'].sort((a, b) => reviewRank[a as keyof typeof reviewRank] - reviewRank[b as keyof typeof reviewRank]), ['open', 'seen', 'resolved']);
});
