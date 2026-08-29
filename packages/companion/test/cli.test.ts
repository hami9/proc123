/**
 * The command-line companion.
 *
 * Every test here drives `run` with injected dependencies: no network, no
 * disk, no process to exit (CLAUDE.md §12). What is worth testing is the part
 * a user actually meets — exit codes, what gets said when something is wrong,
 * and whether the things that would silently produce a bad CSV are refused.
 *
 * The 10x price question gets its own test because it is the one mistake this
 * tool can make that nobody notices until the products are live in a shop.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type CliDeps, defaultStateDir, run } from '@proc123/companion';

const URL = 'https://ajil.example/c/nuts';

/** A server-rendered category page with two products in schema.org markup. */
const CATEGORY_HTML = `<!doctype html>
<html lang="fa">
  <body>
    <main>
      <div itemscope itemtype="https://schema.org/Product">
        <link itemprop="url" href="/p/walnut" />
        <h2 itemprop="name">گردو</h2>
        <img itemprop="image" src="/img/walnut.jpg" />
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="price" content="150000" />
          <meta itemprop="priceCurrency" content="IRR" />
        </div>
      </div>
      <div itemscope itemtype="https://schema.org/Product">
        <link itemprop="url" href="/p/almond" />
        <h2 itemprop="name">بادام</h2>
        <img itemprop="image" src="/img/almond.jpg" />
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="price" content="98000" />
          <meta itemprop="priceCurrency" content="IRR" />
        </div>
      </div>
    </main>
  </body>
</html>`;

/** A page an SPA storefront would serve: markup arrives, products do not. */
const EMPTY_SHELL = '<!doctype html><html><body><div id="app"></div></body></html>';

interface Harness {
  deps: CliDeps;
  lines: string[];
  files: Map<string, string>;
}

function harness(html = CATEGORY_HTML): Harness {
  const lines: string[] = [];
  const files = new Map<string, string>();

  return {
    lines,
    files,
    deps: {
      fetchHtml: () => Promise.resolve({ html, url: URL }),
      write: (path, contents) => {
        files.set(path, contents);
        return Promise.resolve();
      },
      out: (line) => lines.push(line),
      now: () => '2026-08-16T09:00:00.000Z',
      // Never the user's real state directory.
      stateDir: '/tmp/proc123-test-state-does-not-exist',
      env: {},
    },
  };
}

const said = (h: Harness): string => h.lines.join('\n');

describe('usage', () => {
  it('prints help and succeeds when asked for it', async () => {
    const h = harness();
    const result = await run(['--help'], h.deps);

    expect(result.code).toBe(0);
    expect(said(h)).toContain('scan a shop');
  });

  it('prints help and fails when given nothing', async () => {
    const h = harness();
    const result = await run([], h.deps);

    expect(result.code).toBe(2);
  });

  it('says so plainly when the argument is not a URL', async () => {
    const h = harness();
    const result = await run(['nuts'], h.deps);

    expect(result.code).toBe(2);
    expect(said(h)).toContain('is not a URL');
  });

  it('refuses a non-http scheme before fetching or writing anything', async () => {
    const h = harness();
    const result = await run(['file:///etc/passwd'], h.deps);

    expect(result.code).toBe(2);
    expect(said(h)).toContain('not an http(s) address');
    expect(h.files.size).toBe(0);
  });

  it('rejects a nonsense --unit rather than guessing', async () => {
    const h = harness();
    const result = await run([URL, '--unit', 'dollars'], h.deps);

    expect(result.code).toBe(2);
    expect(said(h)).toContain('must be toman or rial');
  });

  it('rejects a nonsense --max-pages', async () => {
    const h = harness();
    const result = await run([URL, '--max-pages', 'lots'], h.deps);

    expect(result.code).toBe(2);
  });

  it('reports an unknown flag instead of ignoring it', async () => {
    const h = harness();
    const result = await run([URL, '--recursive'], h.deps);

    expect(result.code).toBe(2);
  });
});

describe('scanning', () => {
  it('writes a CSV and says what it wrote', async () => {
    const h = harness();
    const result = await run([URL, '-o', 'out.csv', '--max-pages', '1'], h.deps);

    expect(result.code).toBe(0);
    expect(result.rowCount).toBeGreaterThan(0);

    const csv = h.files.get('out.csv');
    expect(csv).toBeDefined();
    expect(csv).toContain('گردو');
    expect(csv).toContain('بادام');
    expect(said(h)).toContain('row(s) to out.csv');
  });

  it('names the file itself when not told where to write', async () => {
    const h = harness();
    const result = await run([URL, '--max-pages', '1'], h.deps);

    expect(result.csvPath).toMatch(/^proc123-[a-z0-9]+\.csv$/);
    expect(h.files.has(result.csvPath ?? '')).toBe(true);
  });

  it('honours --unit, because reading toman as rial is a 10x error', async () => {
    const toman = harness();
    await run([URL, '-o', 'a.csv', '--unit', 'toman', '--max-pages', '1'], toman.deps);

    const rial = harness();
    await run([URL, '-o', 'b.csv', '--unit', 'rial', '--max-pages', '1'], rial.deps);

    expect(toman.files.get('a.csv')).not.toBe(rial.files.get('b.csv'));
    expect(said(toman)).toContain('read as toman');
    expect(said(rial)).toContain('read as rial');
  });

  it('writes a Shopify file when asked for one', async () => {
    const h = harness();
    await run([URL, '-o', 'out.csv', '--format', 'shopify-csv', '--max-pages', '1'], h.deps);

    const csv = h.files.get('out.csv') ?? '';
    expect(csv).toContain('URL handle');
    expect(csv).toContain('Compare-at price');
    expect(csv).not.toContain('Regular price');
    expect(said(h)).toContain('as shopify-csv');
  });

  it('writes JSON when asked for it, and names the file accordingly', async () => {
    const h = harness();
    const result = await run([URL, '--format', 'json', '--max-pages', '1'], h.deps);

    expect(result.csvPath).toMatch(/\.json$/);
    const json = h.files.get(result.csvPath ?? '') ?? '';
    expect(JSON.parse(json)).toMatchObject({ format: 'proc123-products' });
  });

  it('rejects a format it does not know rather than falling back', async () => {
    const h = harness();
    const result = await run([URL, '--format', 'shopify'], h.deps);

    expect(result.code).toBe(2);
    expect(said(h)).toContain('--format must be one of');
    expect(h.files.size).toBe(0);
  });

  it('explains an empty result rather than just reporting zero', async () => {
    const h = harness(EMPTY_SHELL);
    const result = await run([URL, '-o', 'out.csv', '--max-pages', '1'], h.deps);

    // Still a success: the scan worked, the shop simply served no products.
    expect(result.code).toBe(0);
    expect(said(h)).toContain('use the extension for those');
  });

  it('writes a report when asked', async () => {
    const h = harness();
    await run([URL, '-o', 'out.csv', '--report', 'why.txt', '--max-pages', '1'], h.deps);

    const report = h.files.get('why.txt');
    expect(report).toContain('why is this field empty?');
  });

  it('writes a log when asked, and never puts a key in it', async () => {
    const h = harness();
    await run(
      [
        URL,
        '-o',
        'out.csv',
        '--log',
        'run.jsonl',
        '--ai-key',
        'sk-real-secret',
        '--max-pages',
        '1',
      ],
      h.deps
    );

    const log = h.files.get('run.jsonl');
    expect(log).toBeDefined();
    expect(log).toContain('page.read');
    expect(log).not.toContain('sk-real-secret');
    // The page's HTML is summarised to a length, never written out.
    expect(log).not.toContain('itemprop');
  });

  it('stays quiet under --quiet except for the one line that matters', async () => {
    const h = harness();
    await run([URL, '-o', 'out.csv', '--quiet', '--max-pages', '1'], h.deps);

    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toContain('out.csv');
  });

  it('reports a failed fetch as a failure, not as an empty shop', async () => {
    const h = harness();
    const result = await run([URL, '-o', 'out.csv'], {
      ...h.deps,
      fetchHtml: () => Promise.reject(new Error('the shop answered HTTP 503')),
    });

    expect(result.code).toBe(1);
    expect(said(h)).toContain('503');
    expect(h.files.size).toBe(0);
  });

  it('leaves the AI step alone when it is on but no key was given', async () => {
    const h = harness();
    const config = JSON.stringify({
      aiProvider: { name: 'gemini', model: 'gemini-2.5-flash', enabled: true },
    });

    await run([URL, '-o', 'out.csv', '-c', 'proc123.config.json', '--max-pages', '1'], {
      ...h.deps,
      readConfig: () => Promise.resolve(config),
    });

    expect(said(h)).toContain('no key was given');
  });

  it('reports what it could not use in a config rather than failing', async () => {
    const h = harness();
    const config = JSON.stringify({ maxPages: 'lots', nonsense: true });

    const result = await run([URL, '-o', 'out.csv', '-c', 'c.json', '--max-pages', '1'], {
      ...h.deps,
      readConfig: () => Promise.resolve(config),
    });

    expect(result.code).toBe(0);
    expect(said(h)).toContain('maxPages must be a number');
    expect(said(h)).toContain('"nonsense" is not a proc123 setting');
  });

  it('fails cleanly when the named config cannot be read', async () => {
    const h = harness();
    const result = await run([URL, '-c', 'missing.json'], {
      ...h.deps,
      readConfig: () => Promise.reject(new Error('ENOENT')),
    });

    expect(result.code).toBe(2);
    expect(said(h)).toContain('could not read missing.json');
  });
});

describe('defaultStateDir', () => {
  it('follows XDG on Linux', () => {
    // Joined rather than written out, because `join` uses the separator of
    // whatever platform the suite runs on: the same call yields a backslash
    // path on Windows, and a literal POSIX string would fail there.
    expect(defaultStateDir({ XDG_STATE_HOME: '/home/x/.local/state' })).toBe(
      join('/home/x/.local/state', 'proc123')
    );
  });

  it('follows LOCALAPPDATA on Windows', () => {
    expect(defaultStateDir({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' })).toContain('proc123');
  });

  it('falls back to a dot directory when neither is set', () => {
    expect(defaultStateDir({})).toContain('proc123');
  });
});
