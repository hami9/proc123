/**
 * Bundle the app's front end into `dist/`, which is what Tauri serves.
 *
 * Android's WebView belongs to the device, not to Tauri. A Galaxy S9 with
 * WebView 81 failed to parse the ES2022 bundle before the UI started. Keep an
 * explicit browser floor as well as ES2020; target only lowers syntax, so
 * shared code must also avoid newer runtime APIs such as replaceAll and at.
 *
 * Type checking is the root `npm run typecheck`'s job; esbuild only transpiles,
 * exactly as it does for the extension.
 */

import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');

const watch = process.argv.includes('--watch');

export const buildOptions = {
  entryPoints: { app: resolve(root, 'src/main.ts') },
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: ['es2020', 'chrome81'],
  platform: 'browser',
  // Readable output on purpose, the same choice the extension made: a reviewer
  // or a packager should be able to read every line that ships.
  minify: false,
  sourcemap: true,
  logLevel: 'info',
};

async function run() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  // `index.html` and the stylesheet are copied rather than bundled: Tauri loads
  // the HTML directly and esbuild has no reason to touch it.
  await cp(resolve(root, 'src/index.html'), resolve(dist, 'index.html'));
  await cp(resolve(root, 'src/styles.css'), resolve(dist, 'styles.css'));

  // The typeface and the logo ship inside the app rather than being fetched.
  // §15 allows outbound requests to the shop being scanned and nothing else, and
  // the CSP's `default-src 'self'` would refuse a font CDN anyway — so a
  // webfont link would fail closed and silently fall back to Tahoma.
  await cp(resolve(root, 'src/fonts'), resolve(dist, 'fonts'), { recursive: true });
  await cp(resolve(root, 'src/assets'), resolve(dist, 'assets'), { recursive: true });

  if (watch) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log('watching; the front end rebuilds on save');
    return;
  }

  await build(buildOptions);
  console.log(`built the front end: ${dist}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
