/**
 * Build a single-file executable with Node's SEA support.
 *
 * The point of it is a user who has no Node installed and should not have to
 * care that this was written in TypeScript.
 *
 * Three constraints shape this, and each of them costs something:
 *
 * - **SEA takes CommonJS, not ESM.** So this produces its own CJS bundle rather
 *   than reusing `dist/proc123.js`, which is ESM because that is what `npx` and
 *   `node dist/proc123.js` want. Two bundles, one source tree. It is also why
 *   `src/main.ts` avoids top-level `await`.
 * - **SEA injects into the running Node binary.** The output is therefore for
 *   *this* platform — there is no cross-compilation. A Windows `.exe` has to be
 *   built on Windows, which is a job for the release matrix (Phase 11), not a
 *   flag here. This script names the platform it produced rather than letting
 *   anyone assume it produced all of them.
 * - **The binary carries a whole Node runtime,** so ~60MB is expected and is not
 *   a sign that something went wrong.
 *
 * Two ways to get there, and the newer one is much better:
 *
 * - `node --build-sea <config>` (Node 24+) does the whole thing in one step.
 * - Older Node needs the blob generated separately and injected with
 *   `postject`, which is an alpha-stage dependency that segfaults against some
 *   Node builds. Kept as a fallback, used only when `--build-sea` is absent.
 */

import { build } from 'esbuild';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, 'dist', 'binary');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/** `proc123-linux-x64`, `proc123-win32-x64.exe`, … — self-describing on disk. */
const name = `proc123-${process.platform}-${process.arch}${isWindows ? '.exe' : ''}`;
const binary = resolve(out, name);
const script = resolve(out, 'proc123.cjs');
const configPath = resolve(out, 'sea-config.json');

/** Does this Node have the one-step build? */
async function hasBuildSea() {
  const { stdout } = await run(process.execPath, ['--help']);
  return stdout.includes('--build-sea');
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// 1. A CommonJS bundle, because that is what SEA can run.
await build({
  entryPoints: [resolve(root, 'src/main.ts')],
  outfile: script,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['node20'],
  logLevel: 'info',
  minify: false,
});

const oneStep = await hasBuildSea();

// 2. The SEA config. `output` is the finished executable under `--build-sea`,
//    and an intermediate blob under the older flow — the only difference.
await writeFile(
  configPath,
  JSON.stringify(
    {
      main: script,
      output: oneStep ? binary : resolve(out, 'proc123.blob'),
      // The warning is aimed at people who did not mean to build one of these.
      disableExperimentalSEAWarning: true,
    },
    null,
    2
  )
);

if (oneStep) {
  await run(process.execPath, ['--build-sea', configPath]);
} else {
  const { copyFile, readFile } = await import('node:fs/promises');

  let inject;
  try {
    ({ inject } = await import('postject'));
  } catch {
    throw new Error(
      `this Node (${process.version}) has no --build-sea, and the postject fallback is not ` +
        `installed. Either run \`npm install\` in the workspace, or use Node 24 or newer.`
    );
  }

  await run(process.execPath, ['--experimental-sea-config', configPath]);
  await copyFile(process.execPath, binary);

  // The fuse string is Node's own, and must match exactly or the runtime will
  // not find the blob at startup.
  await inject(binary, 'NODE_SEA_BLOB', await readFile(resolve(out, 'proc123.blob')), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(isMac ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
}

if (!isWindows) await chmod(binary, 0o755);

// 3. Prove it runs. A binary that builds and then segfaults is exactly the
//    failure this step exists to catch, and it is not visible from the build
//    output — only from running the thing.
const { stdout } = await run(binary, ['--help']);
if (!stdout.includes('proc123')) {
  throw new Error(`${binary} built but did not run: --help printed nothing recognisable`);
}

console.log(`built ${binary} (${oneStep ? 'node --build-sea' : 'postject'})`);
console.log(
  `this is a ${process.platform}/${process.arch} binary — ` +
    `other platforms have to be built on themselves (see the comment at the top).`
);
