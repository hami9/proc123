/**
 * The service worker: the only place in the extension that touches the network.
 *
 * It is also the only long-lived-ish thing here, and it is not very long-lived
 * — Chrome kills it when idle. Nothing is kept in memory between messages;
 * every scan reads and writes its state through `storage`.
 */

import {
  type CurrencyUnit,
  type ExporterName,
  type FieldPick,
  type ProfileHealthSummary,
  canonicalizeUrl,
  checkProfileHealth,
  createLogger,
  explainScan,
  formatLog,
  formatReport,
  learnProfile,
  loadHtml,
  shortHash,
} from '@proc123/core';
import {
  EXPORTER_EXTENSIONS,
  EXPORTER_MIME_TYPES,
  exportProducts,
  exportWarnings,
} from '@proc123/exporters';
import type { ProfileField } from '@proc123/profiles';

import { runtime, scripting, storage } from './browser.js';
import { createFetchClient } from './http.js';
import {
  isExportRequest,
  isLastResultRequest,
  isReportRequest,
  isScanRequest,
  isScanStatusRequest,
  isTeachRequest,
} from './messages.js';
import type {
  ExportedCsv,
  ExportedReport,
  ExtensionResponse,
  ScanProgress,
  ScanSummary,
  TeachResult,
} from './messages.js';
import { PICKER_STEPS, pickerScript } from './picker.js';
import { loadProfile, saveProfile } from './profiles.js';
import { loadApiKey, loadSettings } from './settings.js';
import { crawlIdFor, runScan } from './scan.js';
import { createChromeCrawlStore, loadLastResult, saveLastResult } from './storage.js';

/**
 * Read the page as the user is seeing it.
 *
 * `document.documentElement.outerHTML` is the *rendered* DOM, which is the
 * whole argument for building this as an extension (CLAUDE.md §2): an SPA
 * storefront that ships an empty shell to a scraper is fully rendered here, for
 * free, in the user's own session.
 *
 * The function is serialized and injected, so it must close over nothing.
 */
async function readPage(tabId: number): Promise<{ url: string; html: string; title: string }> {
  const [injected] = await scripting.executeScript({
    target: { tabId },
    func: () => ({
      url: location.href,
      html: document.documentElement.outerHTML,
      title: document.title,
    }),
  });

  const result = injected?.result;
  if (result === undefined) {
    throw new Error('Could not read this tab. Try reloading the page and scanning again.');
  }
  return result;
}

/**
 * The scan currently running, if any.
 *
 * A crawl outlives the message that asked for it. Holding the reply channel
 * open for the whole thing is what produced "Could not establish connection:
 * receiving end does not exist" on large catalogues — minutes of paced
 * requests look like idleness to MV3, the worker is shut down, and the reply
 * never comes even though the crawl had been persisting its progress the
 * whole way. So the scan is tracked here and asked about instead.
 *
 * One at a time, deliberately: two crawls of the same site at once would
 * double the request rate on someone else's server, which §10 exists to
 * prevent.
 */
interface ActiveScan {
  url: string;
  progress: ScanProgress;
  /** Set when the crawl finishes; the popup collects it on its next poll. */
  summary?: ScanSummary;
  /** Set when it failed, for the same reason. */
  error?: string;
}

let active: ActiveScan | undefined;

/**
 * Keep the worker up for as long as there is real work.
 *
 * The crawl spends most of its life waiting between requests (§10's
 * politeness), and a timer is not an extension event, so nothing tells the
 * browser this worker is busy. Touching an extension API on an interval does.
 * Cleared the moment the scan settles — a keepalive that outlives its work is
 * just a worker that will not die.
 */
function startKeepalive(): () => void {
  const timer = setInterval(() => {
    void storage.local.get(KEEPALIVE_KEY).catch(() => undefined);
  }, KEEPALIVE_MS);
  return () => {
    clearInterval(timer);
  };
}

const KEEPALIVE_KEY = 'proc123.keepalive';
/** Comfortably inside the 30s idle window both engines use. */
const KEEPALIVE_MS = 20_000;

async function handleScan(request: {
  tabId: number;
  canFetch: boolean;
  restart?: boolean;
}): Promise<ScanSummary> {
  const { url, html, title } = await readPage(request.tabId);

  // A profile only matters when the layers above it come up empty, so it is
  // loaded unconditionally and used conditionally, inside the scan.
  const profile = await loadProfile(url);
  const config = await loadSettings();
  // Read only when the user has actually turned Layer D on, so a stored key is
  // not pulled into memory by every scan that will never use it.
  const apiKey = config.aiProvider.enabled ? await loadApiKey() : '';

  const summary = await runScan(
    {
      page: { url, html },
      title,
      config,
      ...(profile === undefined ? {} : { profile }),
      ...(request.restart === true ? { restart: true } : {}),
    },
    {
      // No permission for this origin means no requests to it — so the scan
      // reads the one page the user already has open and says so, rather than
      // asking again or reaching out anyway.
      ...(request.canFetch ? { http: createFetchClient() } : {}),
      ...(apiKey === '' ? {} : { apiKey }),
      store: createChromeCrawlStore(),
      onProgress: (progress) => {
        if (active?.url === url) active.progress = { ...progress };
      },
    }
  );

  await saveLastResult(summary);

  // CLAUDE.md §14 step 5 asks for exactly this, and it stays useful: the
  // worker's console is where a scan that went wrong is diagnosed.
  console.info(
    `[proc123] ${String(summary.rowCount)} rows ` +
      `(${String(summary.productCount)} products, ${String(summary.variationCount)} variations) ` +
      `from ${String(summary.pagesScanned)} page(s) via Layer ${summary.layer} ` +
      `on ${summary.platform} — ${summary.status}`
  );

  return summary;
}

/** Words for the fields the picker asks about, in the order it asks. */
const STEP_LABELS: Record<ProfileField, string> = {
  name: 'product name',
  regularPrice: 'price',
  image: 'product image',
  salePrice: 'sale price',
  url: 'product link',
  sku: 'SKU',
  availability: 'stock label',
};

/**
 * Teach this site.
 *
 * The picker runs in the page and returns index paths; every judgement about
 * what those elements *mean* is made here, by `core`, against the same HTML —
 * so the derivation is the tested one rather than whatever the page's DOM
 * happened to make convenient.
 */
async function handleTeach(request: { tabId: number; url: string }): Promise<TeachResult> {
  const labels = PICKER_STEPS.map((field) => STEP_LABELS[field]);

  const [picked] = await scripting.executeScript({
    target: { tabId: request.tabId },
    func: pickerScript,
    args: [labels],
  });

  const result = picked?.result;
  if (result === undefined || result.cancelled) {
    return { cardCount: 0, warnings: [], cancelled: true };
  }

  // Read the page *after* picking: the user may have scrolled more products in.
  const { url, html } = await readPage(request.tabId);

  const picks: FieldPick[] = PICKER_STEPS.map((field, index) => ({
    field,
    path: result.paths[index] ?? [],
  })).filter((pick) => pick.path.length > 0);

  const learned = learnProfile(loadHtml(html), picks, { url });
  if (learned.profile === undefined) {
    return { cardCount: 0, warnings: learned.warnings, cancelled: false };
  }

  await saveProfile(learned.profile);
  console.info(
    `[proc123] learned ${learned.profile.domain}: ` +
      `"${learned.profile.card.container}" matched ${String(learned.cardCount)} cards`
  );

  return {
    domain: learned.profile.domain,
    cardCount: learned.cardCount,
    warnings: learned.warnings,
    cancelled: false,
  };
}

/** `proc123-ajil.example-2026-08-16.csv` — recognisable in a downloads folder. */
function filenameFor(url: string, exporter: ExporterName): string {
  const date = new Date().toISOString().slice(0, 10);
  let host = 'export';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // A malformed URL is not worth failing an export over.
  }
  // The exporter is in the name because the two CSVs are not interchangeable
  // and both end in `.csv` — a downloads folder with three of these in it
  // should not be a guessing game.
  const kind =
    exporter === 'woocommerce-csv' ? 'woo' : exporter === 'shopify-csv' ? 'shopify' : 'json';
  return `proc123-${host}-${date}-${kind}.${EXPORTER_EXTENSIONS[exporter]}`;
}

/**
 * Build the file from the saved crawl rather than from anything held in memory:
 * the worker that ran the scan has very likely been killed since.
 *
 * The text is handed back to the popup rather than downloaded here, because a
 * service worker has no `URL.createObjectURL` — the popup makes the blob.
 *
 * Which exporter runs comes from the config, and the request may override it so
 * a user can take the same scan to two shops without changing their settings.
 */
async function handleExport(request: {
  url: string;
  displayUnit: CurrencyUnit;
  exporter?: ExporterName;
}): Promise<ExportedCsv> {
  const state = await createChromeCrawlStore().load(crawlIdFor(request.url));
  if (state === undefined || state.products.length === 0) {
    throw new Error('Nothing to export yet — scan the category first.');
  }

  const config = await loadSettings();
  const exporter = request.exporter ?? config.exporter;

  // The user was shown the detected units and picked this one, so it is a
  // decision rather than a guess (CLAUDE.md §7.8). Both CSVs need it; JSON
  // deliberately does not, and keeps the unknown unit unknown.
  const shared = {
    displayUnit: request.displayUnit,
    currencyCode: config.currency.code,
    contentMode: config.contentMode,
    bom: true,
  };

  const outcome = exportProducts(state.products, exporter, {
    woocommerce: shared,
    shopify: shared,
    json: { scannedUrl: request.url },
  });
  const warnings = exportWarnings(outcome);

  console.info(
    `[proc123] exported ${String(outcome.rowCount)} rows as ${exporter} with ${String(warnings.length)} warning(s)`
  );

  return {
    filename: filenameFor(request.url, exporter),
    csv: outcome.text,
    rowCount: outcome.rowCount,
    mimeType: EXPORTER_MIME_TYPES[exporter],
    warnings,
  };
}

/**
 * Build the "why is this field empty?" report (CLAUDE.md §11).
 *
 * Everything comes from the saved crawl rather than a fresh scan, so the report
 * explains the export the user is actually looking at. The one thing that
 * cannot come from storage is profile health: whether a taught selector still
 * matches is a question about the page *now*, so the tab is re-read when there
 * is one, and the check is simply skipped when there is not.
 */
async function handleReport(request: { url: string; tabId?: number }): Promise<ExportedReport> {
  const state = await createChromeCrawlStore().load(crawlIdFor(request.url));
  if (state === undefined) {
    throw new Error('There is no scan to explain yet — scan the category first.');
  }

  const config = await loadSettings();
  const log = createLogger({ level: 'debug' }).child({ crawlId: state.id });

  log.info('report.requested', {
    url: request.url,
    products: state.products.length,
    pagesScanned: state.pagesScanned,
    requests: state.requests,
    status: state.status,
    layer: state.layer,
    platform: state.platform,
  });
  for (const issue of state.issues) {
    log[issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warn' : 'info'](
      `issue.${issue.code}`,
      {
        ...(issue.kind === undefined ? {} : { kind: issue.kind }),
        ...(issue.field === undefined ? {} : { field: issue.field }),
        ...(issue.url === undefined ? {} : { url: issue.url }),
        message: issue.message,
      }
    );
  }

  let health: ProfileHealthSummary | undefined;
  const profile = await loadProfile(request.url);
  if (profile !== undefined && request.tabId !== undefined) {
    try {
      const page = await readPage(request.tabId);
      const checked = checkProfileHealth({ url: page.url, html: page.html }, profile);
      health = {
        healthy: checked.healthy,
        summary: checked.summary,
        brokenFields: checked.brokenFields,
      };
      log.info('profile.health', {
        domain: checked.domain,
        healthy: checked.healthy,
        cardCount: checked.cardCount,
        brokenFields: checked.brokenFields,
      });
    } catch {
      // The tab moved on, or the page will not read. The rest of the report is
      // still worth having, so this is not allowed to fail the whole thing.
      log.warn('profile.health.skipped', { reason: 'the page could not be read' });
    }
  }

  const report = explainScan({
    url: request.url,
    products: state.products,
    issues: state.issues,
    config,
    ...(health === undefined ? {} : { profileHealth: health }),
  });

  return {
    filename: `proc123-report-${shortHash(canonicalizeUrl(request.url), 8)}.txt`,
    text: formatReport(report),
    log: formatLog(log.records()),
    summary: report.summary,
  };
}

runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isScanRequest(message)) {
    // Already running for this page: say so rather than starting a second
    // crawl over the same server.
    if (active !== undefined && active.summary === undefined && active.error === undefined) {
      sendResponse({ ok: true, kind: 'started' } satisfies ExtensionResponse);
      return false;
    }

    active = {
      url: message.url,
      progress: { pagesScanned: 0, productCount: 0, queued: 0, status: 'running' },
    };
    const stopKeepalive = startKeepalive();

    handleScan(message).then(
      (summary) => {
        stopKeepalive();
        if (active?.url === message.url) active.summary = summary;
      },
      (error: unknown) => {
        stopKeepalive();
        const text = error instanceof Error ? error.message : String(error);
        console.error('[proc123] scan failed', error);
        if (active?.url === message.url) active.error = text;
      }
    );

    // Answered now, not when the crawl ends. The popup follows it with
    // `scan-status` — see the note on `ScanStatusRequest`.
    sendResponse({ ok: true, kind: 'started' } satisfies ExtensionResponse);
    return false;
  }

  if (isScanStatusRequest(message)) {
    if (active === undefined || active.url !== message.url) {
      // Nothing running for this page. The worker may have been restarted
      // since; the saved result is the honest answer, and `undefined` from it
      // means there is genuinely nothing.
      loadLastResult<ScanSummary>().then(
        (summary) => {
          sendResponse({ ok: true, kind: 'summary', summary } satisfies ExtensionResponse);
        },
        () => {
          sendResponse({
            ok: true,
            kind: 'summary',
            summary: undefined,
          } satisfies ExtensionResponse);
        }
      );
      return true;
    }

    if (active.error !== undefined) {
      sendResponse({ ok: false, message: active.error } satisfies ExtensionResponse);
      return false;
    }
    if (active.summary !== undefined) {
      sendResponse({
        ok: true,
        kind: 'summary',
        summary: active.summary,
      } satisfies ExtensionResponse);
      return false;
    }
    sendResponse({
      ok: true,
      kind: 'progress',
      progress: active.progress,
    } satisfies ExtensionResponse);
    return false;
  }

  if (isTeachRequest(message)) {
    handleTeach(message).then(
      (taught) => {
        sendResponse({ ok: true, kind: 'taught', taught } satisfies ExtensionResponse);
      },
      (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        console.error('[proc123] teaching failed', error);
        sendResponse({ ok: false, message: text } satisfies ExtensionResponse);
      }
    );
    return true;
  }

  if (isExportRequest(message)) {
    handleExport(message).then(
      (download) => {
        sendResponse({ ok: true, kind: 'download', download } satisfies ExtensionResponse);
      },
      (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        console.error('[proc123] export failed', error);
        sendResponse({ ok: false, message: text } satisfies ExtensionResponse);
      }
    );
    return true;
  }

  if (isReportRequest(message)) {
    handleReport(message).then(
      (report) => {
        sendResponse({ ok: true, kind: 'report', report } satisfies ExtensionResponse);
      },
      (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        console.error('[proc123] report failed', error);
        sendResponse({ ok: false, message: text } satisfies ExtensionResponse);
      }
    );
    return true;
  }

  if (isLastResultRequest(message)) {
    loadLastResult<ScanSummary>().then(
      (summary) => {
        sendResponse({ ok: true, kind: 'summary', summary } satisfies ExtensionResponse);
      },
      () => {
        sendResponse({ ok: true, kind: 'summary', summary: undefined } satisfies ExtensionResponse);
      }
    );
    return true;
  }

  return undefined;
});
