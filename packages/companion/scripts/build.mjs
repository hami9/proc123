/**
 * Bundle the companion into one JavaScript file.
 *
 * A single file rather than a `dist/` tree of modules, because the next step
 * (`package.mjs`) hands it to Node's Single Executable Application support,
 * which takes exactly one script. It is also what makes `npx proc123` work
 * without the workspace being installed.
 *
 * `platform: 'node'` with `packages: 'bundle'` pulls the workspace packages in
 * — they are consumed from TypeScript source and have no published build — and
 * leaves Node's own built-ins alone.
 */

import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/main.ts')],
  outfile: resolve(dist, 'proc123.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  // Node 20 is the oldest release with the SEA support `package.mjs` uses.
  target: ['node20'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: 'linked',
  logLevel: 'info',
  minify: false,
});

console.log(`built ${resolve(dist, 'proc123.js')}`);
