import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

export async function loadBundle(): Promise<{ body: string; exports: string }> {
  const require = createRequire(import.meta.url);
  const source = await readFile(require.resolve('@guidepup/virtual-screen-reader/browser.js'), 'utf8');
  return parseBundle(source);
}

export function parseBundle(source: string): { body: string; exports: string } {
  const match = source.match(/export\s*\{([^}]*)\};?/);
  if (!match) throw new Error('Unexpected virtual screen reader bundle format.');
  const body = source.replace(match[0], '').replace(/\/\/# sourceMappingURL.*$/m, '');
  const exports = match[1].split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
    const [local, exported] = entry.split(/\s+as\s+/);
    return `${exported ?? local}: ${local}`;
  }).join(', ');
  return { body, exports };
}
