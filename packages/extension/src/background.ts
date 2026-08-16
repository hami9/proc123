/**
 * The service worker: the only place in the extension that touches the network.
 *
 * It is also the only long-lived-ish thing here, and it is not very long-lived
 * — Chrome kills it when idle. Nothing is kept in memory between messages;
 * every scan reads and writes its state through `chrome.storage`.
 */

import type { CurrencyUnit } from '@proc123/core';
import { exportWooCommerceCsv } from '@proc123/exporters';

import { createFetchClient } from './http.js';
import { isExportRequest, isLastResultRequest, isScanRequest } from './messages.js';
import type { ExportedCsv, ExtensionResponse, ScanSummary } from './messages.js';
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
  const [injected] = await chrome.scripting.executeScript({
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

async function handleScan(request: {
  tabId: number;
  canFetch: boolean;
  restart?: boolean;
}): Promise<ScanSummary> {
  const { url, html, title } = await readPage(request.tabId);

  const summary = await runScan(
    {
      page: { url, html },
      title,
      ...(request.restart === true ? { restart: true } : {}),
    },
    {
      // No permission for this origin means no requests to it — so the scan
      // reads the one page the user already has open and says so, rather than
      // asking again or reaching out anyway.
      ...(request.canFetch ? { http: createFetchClient() } : {}),
      store: createChromeCrawlStore(),
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

/** `proc123-ajil.example-2026-08-16.csv` — recognisable in a downloads folder. */
function filenameFor(url: string): string {
  const date = new Date().toISOString().slice(0, 10);
  let host = 'export';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // A malformed URL is not worth failing an export over.
  }
  return `proc123-${host}-${date}.csv`;
}

/**
 * Build the CSV from the saved crawl rather than from anything held in memory:
 * the worker that ran the scan has very likely been killed since.
 *
 * The CSV is handed back to the popup rather than downloaded here, because a
 * service worker has no `URL.createObjectURL` — the popup makes the blob.
 */
async function handleExport(request: {
  url: string;
  displayUnit: CurrencyUnit;
}): Promise<ExportedCsv> {
  const state = await createChromeCrawlStore().load(crawlIdFor(request.url));
  if (state === undefined || state.products.length === 0) {
    throw new Error('Nothing to export yet — scan the category first.');
  }

  const result = exportWooCommerceCsv(state.products, {
    // The user was shown the detected units and picked this one, so it is a
    // decision rather than a guess (CLAUDE.md §7.8).
    displayUnit: request.displayUnit,
    bom: true,
  });

  console.info(
    `[proc123] exported ${String(result.rowCount)} rows with ${String(result.warnings.length)} warning(s)`
  );

  return {
    filename: filenameFor(request.url),
    csv: result.csv,
    rowCount: result.rowCount,
    warnings: result.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isScanRequest(message)) {
    handleScan(message).then(
      (summary) => {
        sendResponse({ ok: true, kind: 'summary', summary } satisfies ExtensionResponse);
      },
      (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        console.error('[proc123] scan failed', error);
        sendResponse({ ok: false, message: text } satisfies ExtensionResponse);
      }
    );
    // Keeps the channel open for the async reply above.
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
