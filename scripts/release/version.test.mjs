/**
 * The release sync.
 *
 * This is build tooling rather than shipped code, and it is tested anyway for
 * one reason: it runs exactly once per release, unattended, and the failure it
 * is guarding against is silent. A store accepts an upload whose manifest
 * version did not change; nobody finds out until users report that an update
 * did nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  assertVersion,
  readJsonVersion,
  renderPhaseTable,
  renderVersionBadge,
  replaceBetween,
  setJsonVersion,
  setLockfileVersion,
  setUserAgentVersion,
  updateReadme,
} from './version.mjs';

describe('assertVersion', () => {
  it('accepts what semantic-release emits', () => {
    expect(assertVersion('1.0.0')).toBe('1.0.0');
    expect(assertVersion('0.12.3')).toBe('0.12.3');
    expect(assertVersion('2.0.0-beta.1')).toBe('2.0.0-beta.1');
  });

  it('refuses anything else rather than writing it into five files', () => {
    // The `v` prefix is the likely mistake: it is how the tag is spelled, and
    // it is not how the manifests are.
    expect(() => assertVersion('v1.0.0')).toThrow();
    expect(() => assertVersion('1.0')).toThrow();
    expect(() => assertVersion('')).toThrow();
    expect(() => assertVersion(undefined)).toThrow();
  });
});

describe('setJsonVersion', () => {
  const manifest = `{
  "manifest_version": 3,
  "name": "proc123",
  "version": "0.0.1",
  "description": "…"
}
`;

  it('replaces the version and nothing else', () => {
    const next = setJsonVersion(manifest, '1.4.0');

    expect(next).toContain('"version": "1.4.0"');
    // Byte-identical everywhere else: a release diff should be one line.
    expect(next.replace('1.4.0', '0.0.1')).toBe(manifest);
  });

  it('does not mistake manifest_version for the version', () => {
    expect(setJsonVersion(manifest, '1.4.0')).toContain('"manifest_version": 3');
  });

  it('fails loudly when there is nothing to update', () => {
    expect(() => setJsonVersion('{ "name": "x" }', '1.0.0')).toThrow(/no "version" field/);
  });

  it('round-trips with readJsonVersion', () => {
    expect(readJsonVersion(setJsonVersion(manifest, '9.9.9'))).toBe('9.9.9');
  });
});

describe('setUserAgentVersion', () => {
  const source = `const DEFAULT_USER_AGENT =
  'proc123/0.0.1 (+https://github.com/hami9/proc123) catalogue-migration-tool';`;

  it('updates the version a shop operator reads in their logs', () => {
    expect(setUserAgentVersion(source, '1.4.0')).toContain('proc123/1.4.0 (+https');
  });

  it('fails loudly rather than leaving a stale one', () => {
    expect(() => setUserAgentVersion('const x = 1;', '1.0.0')).toThrow(/User-Agent/);
  });
});

describe('renderPhaseTable', () => {
  const phases = [
    { phase: 0, title: 'Monorepo scaffold + CI', status: 'done' },
    { phase: 5, title: 'Variable products & variations', status: 'partial' },
    { phase: 11, title: 'Release automation', status: 'next' },
    { phase: 12, title: 'Additional exporters', status: 'planned' },
  ];

  it('renders a valid Markdown table, one row per phase', () => {
    const table = renderPhaseTable(phases).split('\n');

    expect(table[0]).toMatch(/^\| Phase \|/);
    expect(table[1]).toMatch(/^\| --- \| --- \| --- \|$/);
    expect(table).toHaveLength(phases.length + 2);
    expect(table.every((row) => row.startsWith('| ') && row.endsWith(' |'))).toBe(true);
  });

  it('spells each status the way the README does', () => {
    const table = renderPhaseTable(phases);

    expect(table).toContain('| ✅ done |');
    expect(table).toContain('| partial |');
    expect(table).toContain('| next |');
    // "planned" is an empty cell — the roadmap's own convention.
    expect(table).toContain('| 12 | Additional exporters |  |');
  });

  it('refuses a status it does not know rather than rendering it blank', () => {
    expect(() => renderPhaseTable([{ phase: 1, title: 'x', status: 'nearly' }])).toThrow(
      /unknown status/
    );
  });
});

describe('replaceBetween', () => {
  const doc = 'before\n<!-- x:start -->\nold\n<!-- x:end -->\nafter';

  it('replaces only what is between the markers', () => {
    expect(replaceBetween(doc, 'x', 'new')).toBe(
      'before\n<!-- x:start -->\nnew\n<!-- x:end -->\nafter'
    );
  });

  it('is idempotent, so re-running a release changes nothing', () => {
    const once = replaceBetween(doc, 'x', 'new');
    expect(replaceBetween(once, 'x', 'new')).toBe(once);
  });

  it('fails rather than guessing when the markers are gone', () => {
    expect(() => replaceBetween('no markers here', 'x', 'new')).toThrow(/missing the x markers/);
  });
});

describe('renderVersionBadge', () => {
  it('links the badge at the tag it describes', () => {
    const badge = renderVersionBadge('1.4.0');

    expect(badge).toContain('version-1.4.0-');
    expect(badge).toContain('/releases/tag/v1.4.0');
  });

  it('escapes a hyphen, which shields.io would otherwise read as a separator', () => {
    expect(renderVersionBadge('2.0.0-beta.1')).toContain('version-2.0.0--beta.1-');
  });

  it('says "unreleased" rather than linking to a tag that does not exist', () => {
    const badge = renderVersionBadge('0.0.0');

    expect(badge).toContain('version-unreleased');
    expect(badge).not.toContain('/releases/tag/');
  });
});

describe('updateReadme', () => {
  const readme = [
    '# proc123',
    '<!-- version-badge:start -->',
    '<!-- version-badge:end -->',
    '## Status',
    '<!-- phase-table:start -->',
    'stale table',
    '<!-- phase-table:end -->',
    'the rest',
  ].join('\n');

  const phases = [{ phase: 0, title: 'Scaffold', status: 'done' }];

  it('updates both sections and leaves the prose alone', () => {
    const next = updateReadme(readme, { version: '1.4.0', phases });

    expect(next).toContain('version-1.4.0');
    expect(next).toContain('| Scaffold');
    expect(next).not.toContain('stale table');
    expect(next).toContain('the rest');
    expect(next).toContain('## Status');
  });

  it('is idempotent', () => {
    const once = updateReadme(readme, { version: '1.4.0', phases });
    expect(updateReadme(once, { version: '1.4.0', phases })).toBe(once);
  });
});

describe('setLockfileVersion', () => {
  /**
   * Shaped like npm's own output: the version at the top, again in the
   * `packages[""]` entry, and then dependencies whose versions are npm's to
   * resolve and nobody else's to touch.
   */
  const lockfile = `{
  "name": "proc123",
  "version": "1.6.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "proc123",
      "version": "1.6.0",
      "license": "MIT",
      "workspaces": [
        "packages/*"
      ],
      "devDependencies": {
        "prettier": "^3.5.0"
      }
    },
    "node_modules/prettier": {
      "version": "3.5.0",
      "resolved": "https://registry.npmjs.org/prettier/-/prettier-3.5.0.tgz",
      "dev": true
    }
  }
}
`;

  it('writes the version into both places npm states it', () => {
    const next = setLockfileVersion(lockfile, '1.9.0');

    expect(next.match(/"version": "1\.9\.0"/g)).toHaveLength(2);
    expect(next).not.toContain('"version": "1.6.0"');
  });

  it('leaves every dependency version alone', () => {
    const next = setLockfileVersion(lockfile, '1.9.0');

    expect(next).toContain('"version": "3.5.0"');
    expect(next).toContain('"prettier": "^3.5.0"');
    expect(next).toContain('prettier-3.5.0.tgz');
  });

  it('changes two lines and not one byte more', () => {
    const next = setLockfileVersion(lockfile, '1.9.0');

    // A release touching a lockfile has to be reviewable at a glance, and the
    // only way to prove that is to put the old version back and compare.
    expect(next.replaceAll('"version": "1.9.0"', '"version": "1.6.0"')).toBe(lockfile);
  });

  it('is idempotent, so a re-run is a no-op', () => {
    const once = setLockfileVersion(lockfile, '1.9.0');
    expect(setLockfileVersion(once, '1.9.0')).toBe(once);
  });

  it('holds on a CRLF checkout, which is what git hands over on Windows', () => {
    const crlf = lockfile.replaceAll('\n', '\r\n');
    const next = setLockfileVersion(crlf, '1.9.0');

    expect(next.match(/"version": "1\.9\.0"/g)).toHaveLength(2);
    expect(next).toContain('"version": "3.5.0"');
    // No line ending was rewritten on the way through.
    expect(next.match(/\r\n/g)).toHaveLength(crlf.match(/\r\n/g).length);
  });

  it('refuses rather than rewriting a dependency when the root entry has no version', () => {
    // The failure this guards against: with the `""` entry's version gone, an
    // unbounded search for the next `"version"` finds prettier's and quietly
    // corrupts the lockfile. Throwing is the only acceptable outcome.
    const rootless = lockfile.replace(/^ {6}"version": "1\.6\.0",\n/m, '');

    expect(() => setLockfileVersion(rootless, '1.9.0')).toThrow(/packages\[""\] entry has no/);
    expect(rootless).toContain('"version": "3.5.0"');
  });

  it('fails loudly when there is no packages[""] entry at all', () => {
    const flat = `{\n  "version": "1.6.0",\n  "lockfileVersion": 3\n}\n`;

    expect(() => setLockfileVersion(flat, '1.9.0')).toThrow(/no packages\[""\] entry/);
  });

  it('fails loudly when there is no top-level version', () => {
    expect(() => setLockfileVersion('{ "name": "x" }', '1.9.0')).toThrow(/no top-level "version"/);
  });

  it('refuses a version it cannot release before touching the file', () => {
    expect(() => setLockfileVersion(lockfile, 'v1.9.0')).toThrow();
  });
});
