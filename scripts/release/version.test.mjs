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
  setUserAgentVersion,
  updateReadme,
} from './version.mjs';

describe('assertVersion', () => {
  it('accepts what semantic-release emits', () => {
    expect(assertVersion('1.0.0')).toBe('1.0.0');
    expect(assertVersion('0.12.3')).toBe('0.12.3');
    expect(assertVersion('2.0.0-beta.1')).toBe('2.0.0-beta.1');
  });

  it('refuses anything else rather than writing it into four files', () => {
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
