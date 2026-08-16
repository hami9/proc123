/**
 * Bundle the extension, once per browser family.
 *
 * Two targets, two output directories, two zips:
 *
 * - `dist/chrome/` — Chrome, Edge and Brave. MV3 with a service worker.
 * - `dist/firefox/` — Firefox. MV3 with a background *script*, because Firefox
 *   release does not run extension service workers; and with a
 *   `browser_specific_settings.gecko.id`, without which Firefox will not install
 *   or sign the add-on at all.
 *
 * The JavaScript is identical between them. Everything that actually differs
 * between the two engines is handled at runtime by `src/browser.ts`, which
 * prefers Firefox's promise-returning `browser` global over `chrome`. Shipping
 * one bundle rather than two means a bug cannot be fixed on one browser and
 * missed on the other.
 *
 * Type checking is the root `npm run typecheck`'s job; esbuild only transpiles.
 */

import AdmZip from 'adm-zip';
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');

const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');

/**
 * `only` builds one target during development, so a watch rebuild is not doing
 * twice the work for a browser you do not have open.
 */
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);

const TARGETS = [
  {
    name: 'chrome',
    manifest: 'manifest.chrome.json',
    // The floor Chrome/Edge/Brave support for MV3 service workers.
    esbuildTarget: ['chrome111'],
  },
  {
    name: 'firefox',
    manifest: 'manifest.firefox.json',
    // Firefox 128 is the first ESR with the MV3 surface this extension needs.
    esbuildTarget: ['firefox128'],
  },
];

function optionsFor(target) {
  return {
    entryPoints: {
      background: resolve(root, 'src/background.ts'),
      popup: resolve(root, 'src/popup.ts'),
    },
    outdir: resolve(dist, target.name),
    bundle: true,
    format: 'esm',
    target: target.esbuildTarget,
    platform: 'browser',
    sourcemap: 'linked',
    logLevel: 'info',
    // Not minified: a reviewer at a browser store, and anyone auditing what this
    // extension does on their pages, should be able to read it.
    minify: false,
  };
}

async function copyStatic(target) {
  const out = resolve(dist, target.name);
  await cp(resolve(root, target.manifest), resolve(out, 'manifest.json'));
  await cp(resolve(root, 'src/popup.html'), resolve(out, 'popup.html'));
}

/**
 * Check the version in each manifest against the package's.
 *
 * Two manifests are two places to forget, and a store rejects an upload whose
 * version has not increased — which is a slow way to find out.
 */
async function checkVersions() {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const versions = new Map();

  for (const target of TARGETS) {
    const manifest = JSON.parse(await readFile(resolve(root, target.manifest), 'utf8'));
    versions.set(target.name, manifest.version);
  }

  const distinct = new Set(versions.values());
  if (distinct.size > 1) {
    const listed = [...versions].map(([name, version]) => `${name}=${version}`).join(', ');
    throw new Error(`the manifests disagree about the version (${listed})`);
  }
  const [version] = distinct;
  if (pkg.version !== undefined && pkg.version !== '0.0.0' && pkg.version !== version) {
    throw new Error(`manifest version ${version} does not match package.json ${pkg.version}`);
  }
  return version;
}

/**
 * Zip a built directory for upload to a store.
 *
 * A library rather than shelling out to `zip`: this has to run on whatever
 * machine cuts a release, and `zip` is absent from Windows and from plenty of
 * minimal Linux images. `adm-zip` is a devDependency — it never reaches the
 * bundle a user installs.
 *
 * Source maps are excluded. They are useful when loading the directory
 * unpacked and are dead weight in a store upload, where they double the size
 * and are never read.
 */
async function zipTarget(target, version) {
  const out = resolve(dist, `proc123-${target.name}-${version}.zip`);
  await rm(out, { force: true });

  const archive = new AdmZip();
  archive.addLocalFolder(resolve(dist, target.name), '', (name) => !name.endsWith('.map'));
  await archive.writeZipPromise(out);
  return out;
}

const selected = only === undefined ? TARGETS : TARGETS.filter((t) => t.name === only);
if (selected.length === 0) {
  throw new Error(
    `--only=${only} matched no target; try ${TARGETS.map((t) => t.name).join(' or ')}`
  );
}

const version = await checkVersions();
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

if (watch) {
  for (const target of selected) {
    const ctx = await context(optionsFor(target));
    await ctx.watch();
    await copyStatic(target);
    console.log(`watching ${target.name}; load ${resolve(dist, target.name)} unpacked`);
  }
} else {
  for (const target of selected) {
    await build(optionsFor(target));
    await copyStatic(target);
    console.log(`built ${target.name}: ${resolve(dist, target.name)}`);
  }

  if (zip) {
    for (const target of selected) {
      console.log(`packaged ${await zipTarget(target, version)}`);
    }
  }
}
