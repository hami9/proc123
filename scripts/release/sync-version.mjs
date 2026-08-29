/**
 * Write one version into every file that carries one.
 *
 * Run by semantic-release's `prepare` step, before the changelog is committed
 * and the release is published — so the tag, the GitHub Release, the two store
 * manifests, and the User-Agent a shop sees in its logs all say the same thing.
 *
 *   node scripts/release/sync-version.mjs 1.4.0
 *   node scripts/release/sync-version.mjs --check      # verify, change nothing
 *
 * `--check` is what CI runs on a pull request. It does not check the *version*
 * — on a branch that is legitimately whatever the last release was — but it does
 * check that the generated README sections match `phases.json`, which is the
 * part a human edits by hand and gets wrong.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import * as prettier from 'prettier';

import {
  assertVersion,
  readJsonVersion,
  setJsonVersion,
  setUserAgentVersion,
  updateReadme,
} from './version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

/** Every file that states a version, and how it states it. */
const JSON_FILES = [
  'package.json',
  'packages/extension/manifest.chrome.json',
  'packages/extension/manifest.firefox.json',
  // The installer carries this one. Left unsynced every MSI built as 0.0.0,
  // and Windows reads that as the *installed* version: the next install never
  // looks newer, so upgrading silently does nothing.
  'packages/app/src-tauri/tauri.conf.json',
];

const USER_AGENT_FILE = 'packages/companion/src/http.ts';
const README = 'README.md';
const PHASES = 'scripts/release/phases.json';

const check = process.argv.includes('--check');
const requested = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

const phases = JSON.parse(await readFile(resolve(root, PHASES), 'utf8')).phases;

/**
 * On `--check` the version is read rather than supplied, so the run cannot
 * accidentally rewrite one. `package.json` is the reference: semantic-release
 * writes it first, and everything else is synced to it.
 */
const version = check
  ? (readJsonVersion(await readFile(resolve(root, 'package.json'), 'utf8')) ?? '0.0.0')
  : assertVersion(requested);

const changed = [];

async function apply(file, transform) {
  const path = resolve(root, file);
  const before = await readFile(path, 'utf8');
  // `await` because the README's transform runs Prettier, which is async in
  // Prettier 3. The synchronous transforms are unaffected.
  const after = await transform(before);
  if (after === before) return;

  changed.push(file);
  if (!check) await writeFile(path, after, 'utf8');
}

for (const file of JSON_FILES) {
  await apply(file, (source) => setJsonVersion(source, version));
}
await apply(USER_AGENT_FILE, (source) => setUserAgentVersion(source, version));

/**
 * The README goes through Prettier on the way out.
 *
 * `renderPhaseTable` emits an unaligned table on purpose — Prettier owns
 * Markdown formatting here and has its own view of column widths, including how
 * wide `✅` counts as. Formatting here means the file this writes is already
 * the file `format:check` wants, so a release cannot leave the repository
 * failing its own checks.
 */
const readmePath = resolve(root, README);
const prettierOptions = { ...(await prettier.resolveConfig(readmePath)), filepath: readmePath };
await apply(README, (source) =>
  prettier.format(updateReadme(source, { version, phases }), prettierOptions)
);

if (check) {
  // A version difference on a branch is expected and is not the point; a
  // README that disagrees with phases.json is a real thing to fix.
  const stale = changed.filter((file) => file === README);
  if (stale.length > 0) {
    console.error(
      `${README} does not match ${PHASES}. Run \`npm run release:sync -- ${version}\` and commit the result.`
    );
    process.exitCode = 1;
  } else {
    console.log(`version ${version} is consistent across ${JSON_FILES.length + 2} file(s).`);
  }
} else {
  console.log(
    changed.length === 0
      ? `everything already says ${version}.`
      : `set ${version} in ${changed.join(', ')}.`
  );
}
