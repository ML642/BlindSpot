import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const source = await readFile(require.resolve('@guidepup/virtual-screen-reader/browser.js'), 'utf8');
const match = source.match(/export\s*\{([^}]*)\};?/);
if (!match) throw new Error('Unexpected virtual screen reader bundle format.');
const bundle = {
  body: source.replace(match[0], '').replace(/\/\/# sourceMappingURL.*$/m, ''),
  exports: match[1].split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
    const [local, exported] = entry.split(/\s+as\s+/);
    return `${exported ?? local}: ${local}`;
  }).join(', '),
};

await mkdir('apps/cloudflare/dist', { recursive: true });
await build({
  entryPoints: ['apps/cloudflare/src/index.ts'], outfile: 'apps/cloudflare/dist/worker.js',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  // Browser callbacks are serialized with Function.toString(). Identifier
  // minification and injected name helpers can break their page-side execution.
  minify: false, keepNames: false, sourcemap: true, conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:*', 'node:*', 'assert', 'buffer', 'events', 'fs', 'path', 'stream', 'util', 'url', 'zlib'],
  plugins: [{
    name: 'cloudflare-runtime',
    setup(plugin) {
      plugin.onResolve({ filter: /^\.\/browser-launch\.js$/ }, () => ({ path: resolve('apps/cloudflare/src/browser-launch.ts') }));
      plugin.onResolve({ filter: /^\.\/dns-lookup\.js$/ }, () => ({ path: resolve('apps/cloudflare/src/dns-lookup.ts') }));
      plugin.onResolve({ filter: /^\.\/screen-reader-bundle\.js$/ }, () => ({ path: 'screen-reader', namespace: 'embedded' }));
      plugin.onLoad({ filter: /.*/, namespace: 'embedded' }, () => ({ contents: `export async function loadBundle() { return ${JSON.stringify(bundle)}; }`, loader: 'js' }));
      plugin.onResolve({ filter: /^playwright$/ }, () => ({ path: require.resolve('@cloudflare/playwright') }));
    },
  }],
});
const size = gzipSync(await readFile('apps/cloudflare/dist/worker.js')).length;
if (size > 3_000_000) throw new Error(`Worker exceeds the Free plan upload limit: ${size} bytes compressed.`);
await writeFile('apps/cloudflare/dist/build-info.json', JSON.stringify({ gzipBytes: size }, null, 2));
console.log(`Cloudflare Worker: ${(size / 1024).toFixed(0)} KiB gzip, below the 3 MB free limit.`);
