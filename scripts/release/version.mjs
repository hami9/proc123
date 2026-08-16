/**
 * The pure half of the release sync.
 *
 * `sync-version.mjs` reads and writes files; everything here is string in,
 * string out, so the interesting parts — which files carry a version, what the
 * README table should say — can be tested without a release, a git history, or
 * a temporary directory.
 *
 * The one rule the whole module serves: **a version must appear in exactly one
 * place per artifact, and nowhere by hand.** Two manifests, a package.json and
 * a User-Agent string are four chances to ship a release where something still
 * claims to be the previous one, and a store will happily accept an upload
 * whose manifest version did not change — which is a slow way to find out.
 */

/** `1.2.3`, and nothing else. semantic-release never emits a `v` prefix. */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function assertVersion(version) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`"${String(version)}" is not a version this project can release`);
  }
  return version;
}

/**
 * Set `"version"` in a JSON document without reformatting the rest of it.
 *
 * A targeted replacement rather than parse-and-stringify: the manifests and
 * package files are hand-edited and reviewed, and a release that silently
 * reorders every key produces a diff nobody can read for the one line that
 * actually changed.
 */
export function setJsonVersion(source, version) {
  assertVersion(version);
  const pattern = /^(\s*"version"\s*:\s*")[^"]*(")/m;
  if (!pattern.test(source)) {
    throw new Error('no "version" field to update');
  }
  return source.replace(pattern, `$1${version}$2`);
}

/** Read `"version"` out of a JSON document, for the drift check. */
export function readJsonVersion(source) {
  const found = /^\s*"version"\s*:\s*"([^"]*)"/m.exec(source);
  return found?.[1];
}

const STATUS_CELL = {
  done: '✅ done',
  partial: 'partial',
  next: 'next',
  planned: '',
};

/**
 * Render the phase table from `phases.json`.
 *
 * Deliberately unaligned. Prettier formats Markdown in this repository and has
 * its own opinion about column widths — including how wide `✅` counts as,
 * which is not the same as its `String.length`. Emitting a padded table and
 * then having Prettier repad it would leave the sync and `format:check`
 * permanently disagreeing about the same file. So this produces the minimal
 * valid table and `sync-version.mjs` runs it through Prettier, which makes both
 * paths converge on one answer.
 */
export function renderPhaseTable(phases) {
  const rows = phases.map((entry) => {
    const status = STATUS_CELL[entry.status];
    if (status === undefined) {
      throw new Error(`phase ${String(entry.phase)} has an unknown status "${entry.status}"`);
    }
    return `| ${String(entry.phase)} | ${entry.title} | ${status} |`;
  });

  return ['| Phase |  |  |', '| --- | --- | --- |', ...rows].join('\n');
}

/**
 * Replace the text between two HTML comment markers.
 *
 * Markers rather than "the first table after this heading": a heading can be
 * renamed and a table can move, and either would make this script quietly
 * rewrite the wrong part of the README.
 */
export function replaceBetween(source, marker, replacement) {
  const open = `<!-- ${marker}:start -->`;
  const close = `<!-- ${marker}:end -->`;
  const start = source.indexOf(open);
  const end = source.indexOf(close);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README is missing the ${marker} markers`);
  }
  return `${source.slice(0, start + open.length)}\n${replacement}\n${source.slice(end)}`;
}

/**
 * The shields.io badge, which is the only place a reader sees the version.
 *
 * `0.0.0` is the pre-release state — semantic-release has not cut anything yet
 * — and it gets a badge that says so rather than one linking to a tag that does
 * not exist. The first release replaces it automatically.
 */
export function renderVersionBadge(version) {
  assertVersion(version);
  if (version === '0.0.0') {
    return (
      '[![version](https://img.shields.io/badge/version-unreleased-6b6560)]' +
      '(https://github.com/hami9/proc123/releases)'
    );
  }
  const escaped = version.replace(/-/g, '--');
  return (
    `[![version](https://img.shields.io/badge/version-${escaped}-7a3e1d)]` +
    `(https://github.com/hami9/proc123/releases/tag/v${version})`
  );
}

/** Everything the README owns, in one pass. */
export function updateReadme(readme, { version, phases }) {
  let next = replaceBetween(readme, 'version-badge', renderVersionBadge(version));
  next = replaceBetween(next, 'phase-table', renderPhaseTable(phases));
  return next;
}

/**
 * The companion prints its version at every store it visits, in the User-Agent.
 *
 * A stale one there is not a cosmetic problem: it is what a shop operator reads
 * in their logs when they want to know which build of this is talking to them.
 */
export function setUserAgentVersion(source, version) {
  assertVersion(version);
  const pattern = /(['"`]proc123\/)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;
  if (!pattern.test(source)) {
    throw new Error('no proc123/<version> User-Agent to update');
  }
  return source.replace(pattern, `$1${version}`);
}
