import type { Page } from 'playwright';

/**
 * Evaluate a function in the page with a JSON-serialisable argument.
 * tsx keeps function names through a `__name` helper that does not exist in the
 * page; binding it to the identity function makes serialised helpers safe.
 */
export function inPage<T, A = undefined>(page: Page, fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> {
  const serialized = JSON.stringify(arg ?? null);
  return page.evaluate(`((__name) => (${fn.toString()})(${serialized}))((fn) => fn)`) as Promise<T>;
}
