/**
 * The command-line companion.
 *
 * **What it is for, and what it is not.** The extension exists because a
 * storefront that renders its catalogue in JavaScript ships an empty shell to
 * anything that is not a browser (CLAUDE.md §2). This reads raw HTML, so that
 * limitation applies to it in full: it is the right tool for a server-rendered
 * WooCommerce or Shopify store, and the wrong tool for an SPA. When a scan
 * comes back empty, it says which of those it thinks happened rather than
 * leaving the user to guess.
 *
 * Everything else is the same pipeline the extension runs — same layers, same
 * politeness, same exporter, same resumable state — because the whole point of
 * `core` being platform-neutral is that there is only one implementation to be
 * right (CLAUDE.md §3).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  type CanonicalProduct,
  type CurrencyUnit,
  type Proc123Config,
  applyConfig,
  canonicalizeUrl,
  configToCrawlOptions,
  crawlCategory,
  createLogger,
  createProvider,
  enrichWithAI,
  explainScan,
  formatLog,
  formatReport,
  isResumable,
  isSiteBlockedError,
  parseConfig,
  resolveConfig,
  shortHash,
} from '@proc123/core';
import { exportWooCommerceCsv } from '@proc123/exporters';

import { createFetchClient } from './http.js';
import { createFileCrawlStore, defaultStateDir } from './store.js';

const USAGE = `proc123 — scan a shop's category page and write a CSV another shop can import.

Usage:
  proc123 <category-url> [options]

Options:
  -o, --out <file>        Where to write the CSV. Default: proc123-<hash>.csv
  -c, --config <file>     A proc123.config.json. Default: the built-in defaults.
      --unit <toman|rial> How IRR prices on the page are quoted. Ask the shop if
                          unsure — guessing wrong is a silent 10x error.
      --max-pages <n>     Stop after this many pages. Overrides the config.
      --restart           Ignore any saved progress and start over.
      --report <file>     Also write a "why is this field empty?" report.
      --log <file>        Also write a JSON-lines log.
      --state-dir <dir>   Where resumable crawl state lives.
      --ai-key <key>      Your own AI provider key. Layer D stays off without it.
                          Prefer PROC123_AI_KEY in the environment.
  -q, --quiet             Only print the final line.
  -h, --help              This.

Notes:
  This reads the HTML a server sends. Shops that build their catalogue in the
  browser will look empty here — use the extension for those.
`;

export interface CliDeps {
  /** Injected so tests never touch the network or the disk. */
  fetchHtml?: (url: string) => Promise<{ html: string; url: string }>;
  write?: (path: string, contents: string) => Promise<void>;
  readConfig?: (path: string) => Promise<string>;
  out?: (line: string) => void;
  now?: () => string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CliResult {
  /** Process exit code. 0 success, 1 a real failure, 2 bad usage. */
  code: number;
  rowCount: number;
  csvPath?: string;
}

function isVariation(product: CanonicalProduct): boolean {
  return product.kind === 'variation';
}

/**
 * Read the start page.
 *
 * Deliberately not routed through the polite client: this is one request, made
 * because the user asked for it at the command line, and the pacing that
 * matters applies to the pages the crawler goes on to discover by itself.
 */
async function defaultFetchHtml(url: string): Promise<{ html: string; url: string }> {
  const client = createFetchClient();
  const response = await client({ url });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`the shop answered HTTP ${String(response.status)} for ${url}`);
  }
  return { html: response.body, url: response.url ?? url };
}

export async function run(argv: readonly string[], deps: CliDeps = {}): Promise<CliResult> {
  // `process.stdout.write` rather than `console.log`: this is a command whose
  // output is the product, and `console` is a debugging channel that formats
  // its arguments. Writing the string is what is meant.
  const out =
    deps.out ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const write =
    deps.write ?? ((path, contents): Promise<void> => writeFile(path, contents, 'utf8'));
  const readConfigFile =
    deps.readConfig ?? ((path: string): Promise<string> => readFile(path, 'utf8'));
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
  const now = deps.now ?? ((): string => new Date().toISOString());
  const env = deps.env ?? process.env;

  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        config: { type: 'string', short: 'c' },
        unit: { type: 'string' },
        'max-pages': { type: 'string' },
        restart: { type: 'boolean' },
        report: { type: 'string' },
        log: { type: 'string' },
        'state-dir': { type: 'string' },
        'ai-key': { type: 'string' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    out(USAGE);
    return { code: 2, rowCount: 0 };
  }

  const { values, positionals } = parsed;
  if (values.help === true || positionals.length === 0) {
    out(USAGE);
    return { code: values.help === true ? 0 : 2, rowCount: 0 };
  }

  const startUrl = positionals[0] ?? '';
  try {
    // Rejects `file:` and typos before anything is fetched or written.
    const url = new URL(startUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      out(`"${startUrl}" is not an http(s) address.`);
      return { code: 2, rowCount: 0 };
    }
  } catch {
    out(`"${startUrl}" is not a URL.`);
    return { code: 2, rowCount: 0 };
  }

  const say = (line: string): void => {
    if (values.quiet !== true) out(line);
  };

  // Config first: everything below is derived from it (CLAUDE.md §9).
  let config: Proc123Config;
  if (values.config === undefined) {
    config = resolveConfig(undefined).config;
  } else {
    try {
      const result = parseConfig(await readConfigFile(values.config));
      config = result.config;
      for (const problem of result.problems) say(`config: ${problem}`);
    } catch (error) {
      out(
        `could not read ${values.config}: ${error instanceof Error ? error.message : String(error)}`
      );
      return { code: 2, rowCount: 0 };
    }
  }

  if (values['max-pages'] !== undefined) {
    const max = Number(values['max-pages']);
    if (!Number.isFinite(max) || max < 1) {
      out('--max-pages must be a number of 1 or more.');
      return { code: 2, rowCount: 0 };
    }
    config = { ...config, maxPages: Math.floor(max) };
  }

  if (values.unit !== undefined && values.unit !== 'toman' && values.unit !== 'rial') {
    out('--unit must be toman or rial.');
    return { code: 2, rowCount: 0 };
  }

  const logger = createLogger({ level: 'debug', now });
  const store = createFileCrawlStore(values['state-dir'] ?? deps.stateDir ?? defaultStateDir(env));
  const id = `crawl-${shortHash(canonicalizeUrl(startUrl), 10)}`;

  try {
    const existing = values.restart === true ? undefined : await store.load(id);
    if (isResumable(existing)) {
      say(`Resuming a saved crawl: ${String(existing?.products.length ?? 0)} product(s) so far.`);
    }

    say(`Reading ${startUrl} …`);
    const page = await fetchHtml(startUrl);
    logger.info('page.read', { url: page.url, html: page.html });

    const crawl = await crawlCategory(
      { url: page.url, html: page.html },
      {
        ...configToCrawlOptions(config),
        http: createFetchClient(),
        store,
        id,
        ...(values.restart === true ? { restart: true } : {}),
        now,
      }
    );

    // Layer D, only if the user both switched it on and supplied a key.
    const apiKey = values['ai-key'] ?? env['PROC123_AI_KEY'] ?? '';
    let products = crawl.products;
    let aiIssues = crawl.issues;
    if (config.aiProvider.enabled && apiKey !== '') {
      const provider = createProvider({
        name: config.aiProvider.name,
        apiKey,
        model: config.aiProvider.model,
        client: createFetchClient(),
      });
      if (provider === undefined) {
        say(
          `"${config.aiProvider.name}" is not a provider this build knows; skipping the AI step.`
        );
      } else {
        const onPage = products.filter(
          (product) => canonicalizeUrl(product.sourceUrl) === canonicalizeUrl(page.url)
        );
        const enriched = await enrichWithAI(
          onPage,
          { url: page.url, html: page.html },
          provider,
          config,
          {
            maxRequests: onPage.length,
          }
        );
        const replaced = new Map(
          onPage.map((original, index) => [original, enriched.products[index]])
        );
        products = products.map((product) => replaced.get(product) ?? product);
        aiIssues = [...aiIssues, ...enriched.issues];
        if (enriched.usage.requests > 0) {
          say(
            `AI: ${String(enriched.usage.requests)} request(s), ` +
              `${String(enriched.usage.inputTokens)} in / ${String(enriched.usage.outputTokens)} out tokens.`
          );
        }
      }
    } else if (config.aiProvider.enabled) {
      say('The AI fallback is switched on but no key was given; skipping it.');
    }

    const filtered = applyConfig(products, config);
    const issues = [...aiIssues, ...filtered.issues];
    for (const issue of issues) {
      logger[issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warn' : 'info'](
        `issue.${issue.code}`,
        { message: issue.message, ...(issue.url === undefined ? {} : { url: issue.url }) }
      );
    }

    const rows = filtered.products;
    if (rows.length === 0) {
      // The single most likely cause, said plainly, because "0 products" with
      // no explanation is the least useful thing this could print.
      say(
        'No products were found. If the shop builds its catalogue in the browser, ' +
          'its pages arrive empty here — use the extension for those.'
      );
    }

    // Narrowed by the `--unit` check above, so no assertion is needed here.
    const unit: CurrencyUnit = values.unit ?? config.currency.displayUnit;
    const csv = exportWooCommerceCsv(rows, {
      displayUnit: unit,
      currencyCode: config.currency.code,
      contentMode: config.contentMode,
      bom: true,
    });

    const csvPath = values.out ?? `proc123-${shortHash(canonicalizeUrl(startUrl), 8)}.csv`;
    await write(csvPath, csv.csv);

    if (values.report !== undefined) {
      await write(
        values.report,
        formatReport(explainScan({ url: page.url, products: rows, issues, config }))
      );
    }
    if (values.log !== undefined) await write(values.log, formatLog(logger.records()));

    const variations = rows.filter(isVariation).length;
    for (const warning of csv.warnings.slice(0, 5)) say(`warning: ${warning.message}`);

    out(
      `Wrote ${String(csv.rowCount)} row(s) to ${csvPath} ` +
        `(${String(rows.length - variations)} product(s), ${String(variations)} variation(s), ` +
        `${String(crawl.pagesScanned)} page(s), prices read as ${unit}).`
    );
    return { code: 0, rowCount: csv.rowCount, csvPath };
  } catch (error) {
    // §2: a block ends the scan and is reported as itself, never retried or
    // worked around.
    if (isSiteBlockedError(error)) {
      out(`${error.message} proc123 stops here rather than trying to get around it.`);
      return { code: 1, rowCount: 0 };
    }
    out(error instanceof Error ? error.message : String(error));
    return { code: 1, rowCount: 0 };
  }
}
