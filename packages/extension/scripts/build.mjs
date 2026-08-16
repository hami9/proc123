/**
 * Bundle the extension into `dist/`, ready to load unpacked.
 *
 * A browser cannot run TypeScript, and MV3 content contexts cannot resolve bare
 * package specifiers, so `@proc123/core` has to be bundled in. esbuild rather
 * than a full toolchain because that is the entire requirement — Phase 10 is
 * where signing, cross-browser manifests and release packaging get built.
 *
 * Type checking is the root `npm run typecheck`'s job; esbuild only transpiles.
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
  entryPoints: {
    background: resolve(root, 'src/background.ts'),
    popup: resolve(root, 'src/popup.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'esm',
  // The floor Chrome/Edge/Brave support for MV3 service workers.
  target: ['chrome111'],
  platform: 'browser',
  sourcemap: 'linked',
  logLevel: 'info',
  // Not minified: a reviewer at a browser store, and anyone auditing what this
  // extension does on their pages, should be able to read it.
  minify: false,
};

async function copyStatic() {
  await cp(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));
  await cp(resolve(root, 'src/popup.html'), resolve(dist, 'popup.html'));
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  await copyStatic();
  console.log(`watching; load ${dist} as an unpacked extension`);
} else {
  await build(options);
  await copyStatic();
  console.log(`built; load ${dist} as an unpacked extension`);
}
