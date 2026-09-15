import assert from 'node:assert/strict';
import { test } from 'node:test';
import { friendlyToolError } from '../apps/server/src/event-messages.js';

test('browser tool errors are converted to concise user-facing activity', () => {
  const hidden = String.raw`locator.click: Timeout 3000ms exceeded.
Call log:
\u001b[2m - waiting for locator('a[href*="account.jetbrains.com"]').first()\u001b[22m
 - element is not visible`;
  const missing = String.raw`locator.elementHandle: Timeout 3000ms exceeded.
Call log:
 - waiting for getByText('Navigate to profile').first()`;

  assert.equal(friendlyToolError('click', hidden), 'Could not activate the requested control because it is not visible.');
  assert.equal(friendlyToolError('click', missing), 'Could not find the requested control on this page.');
  assert.equal(friendlyToolError('navigate', 'Timeout 3000ms exceeded.'), 'The requested page did not respond in time.');
  assert.doesNotMatch(friendlyToolError('click', hidden), /locator|Call log|JetBrains|3000/);
});
