/** Keep browser internals and raw tool arguments out of activity messages. */
export function friendlyToolError(action: string, rawMessage: string): string {
  const message = rawMessage.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').toLowerCase();
  const label = action === 'click' ? 'control' : action === 'navigate' ? 'page' : 'browser action';
  if (/element is not visible|not visible/.test(message)) return `Could not activate the requested ${label} because it is not visible.`;
  if (/waiting for|getbytext|locator\.elementhandle/.test(message) && /timeout/.test(message)) return `Could not find the requested ${label} on this page.`;
  if (/timeout|timed out/.test(message)) return `The requested ${label} did not respond in time.`;
  if (/disabled|not enabled/.test(message)) return `The requested ${label} is currently disabled.`;
  return `The requested ${label} could not be completed.`;
}
