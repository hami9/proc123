/**
 * Bundle the app's front end into `dist/`, which is what Tauri serves.
 *
 * One target, unlike the extension's two: Tauri ships a known WebView per
 * platform, so there is no engine-detection problem to solve here. The floor is
 * set by the oldest of them — WebView2 on Windows, WebKitGTK on Linux, and the
 * Android System WebView in phase 18 — and `es2022` clears all three
 * comfortably.
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

const options = {
  entryPoints: { app: resolve(root, 'src/main.ts') },
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: ['es2022'],
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

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('watching; the front end rebuilds on save');
    return;
  }

  await build(options);
  console.log(`built the front end: ${dist}`);
}

await run();
