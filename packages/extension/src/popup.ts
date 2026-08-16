/**
 * The popup.
 *
 * Two things it owns that the worker cannot:
 *
 * - **The permission prompt.** `permissions.request` only works inside a
 *   user gesture, so asking has to happen in the click handler. `activeTab`
 *   already covers reading the page the user is looking at; permission for the
 *   origin is only needed to fetch the *other* pages of the category, so the
 *   scan degrades to one page rather than failing if it is declined.
 * - **Surviving its own death.** A popup is destroyed the moment it loses
 *   focus, so on open it asks the worker for the last result instead of
 *   assuming it has none.
 */

import {
  ALL_TARGET_FIELDS,
  type ContentMode,
  type CurrencyUnit,
  type Proc123Config,
  type ProductKind,
  type TargetField,
} from '@proc123/core';

import { type Tab, permissions, runtime, tabs } from './browser.js';
import { loadApiKey, loadSettings, saveApiKey, saveSettings } from './settings.js';

import type { ExtensionResponse, ScanSummary } from './messages.js';

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing #${id}`);
  return found as T;
};

const scanButton = element<HTMLButtonElement>('scan');
const rescanButton = element<HTMLButtonElement>('rescan');
const statusLine = element('status');
const pageLine = element('page');
const counts = element('counts');
const headline = element('headline');
const detail = element<HTMLDListElement>('detail');
const issueList = element<HTMLUListElement>('issues');
const exportBox = element('export');
const unitRow = element('unitRow');
const unitSelect = element<HTMLSelectElement>('unit');
const downloadButton = element<HTMLButtonElement>('download');
const explainButton = element<HTMLButtonElement>('explain');
const teachButton = element<HTMLButtonElement>('teach');

/** The page the rendered summary belongs to, so export targets the right scan. */
let scannedUrl: string | undefined;

const settingsHint = element('settingsHint');
const fieldChecks = element('fields');
const typeChecks = element('types');

/** Everything a person would rather read than `regularPrice`. */
const FIELD_LABELS: Record<TargetField, string> = {
  name: 'name',
  sku: 'SKU',
  description: 'description',
  shortDescription: 'short description',
  regularPrice: 'regular price',
  salePrice: 'sale price',
  categories: 'categories',
  images: 'images',
  attributes: 'attributes',
  stock: 'stock',
  tags: 'tags',
  weight: 'weight',
  dimensions: 'dimensions',
  brand: 'brand',
  gtin: 'GTIN',
};

const PRODUCT_KINDS: ProductKind[] = ['simple', 'variable'];

let settings: Proc123Config | undefined;

function checkbox(
  container: HTMLElement,
  value: string,
  label: string,
  checked: boolean,
  disabled = false
): HTMLInputElement {
  const wrap = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = value;
  input.checked = checked;
  input.disabled = disabled;

  wrap.append(input, document.createTextNode(label));
  container.append(wrap);
  return input;
}

function readSettings(): Proc123Config | undefined {
  if (settings === undefined) return undefined;

  const fields = [...fieldChecks.querySelectorAll('input')]
    .filter((input) => input.checked)
    .map((input) => input.value as TargetField);
  const types = [...typeChecks.querySelectorAll('input')]
    .filter((input) => input.checked)
    .map((input) => input.value as ProductKind);

  const category = element<HTMLInputElement>('categoryFilter').value.trim();

  return {
    ...settings,
    targetFields: fields.length > 0 ? fields : settings.targetFields,
    productTypes: types.length > 0 ? types : settings.productTypes,
    ...(category === '' ? {} : { categoryFilter: category }),
    maxPages: Number(element<HTMLInputElement>('maxPages').value) || settings.maxPages,
    contentMode: element<HTMLSelectElement>('contentMode').value as ContentMode,
    currency: {
      code: element<HTMLInputElement>('currencyCode').value.trim().toUpperCase() || 'IRR',
      displayUnit: element<HTMLSelectElement>('displayUnit').value as CurrencyUnit,
    },
    politeness: {
      delayMsBetweenRequests: Number(element<HTMLInputElement>('delayMs').value),
      maxConcurrent: Number(element<HTMLInputElement>('maxConcurrent').value) || 1,
    },
    // The key is deliberately not here: `aiProvider` is serialised into
    // `proc123.config.json`, and a key must never travel with it (CLAUDE.md §4).
    aiProvider: {
      name: element<HTMLSelectElement>('aiProvider').value,
      model: element<HTMLInputElement>('aiModel').value.trim() || settings.aiProvider.model,
      enabled: element<HTMLInputElement>('aiEnabled').checked,
    },
  };
}

async function persistSettings(): Promise<void> {
  const next = readSettings();
  if (next === undefined) return;

  settings = next;
  await saveSettings(next);
  await saveApiKey(element<HTMLInputElement>('aiApiKey').value);

  const key = element<HTMLInputElement>('aiApiKey').value.trim();
  settingsHint.textContent =
    next.aiProvider.enabled && key === ''
      ? 'The AI fallback needs your own API key before it can run.'
      : next.politeness.delayMsBetweenRequests < 400
        ? 'A short delay puts more load on the store you are reading.'
        : next.contentMode === 'reference'
          ? 'Descriptions will be copied. They are the store’s content, not yours.'
          : '';
}

async function renderSettings(): Promise<void> {
  settings = await loadSettings();

  fieldChecks.replaceChildren();
  for (const field of ALL_TARGET_FIELDS) {
    // Name is not optional: no row can be exported without it.
    checkbox(
      fieldChecks,
      field,
      FIELD_LABELS[field],
      settings.targetFields.includes(field),
      field === 'name'
    );
  }

  typeChecks.replaceChildren();
  for (const kind of PRODUCT_KINDS) {
    checkbox(typeChecks, kind, kind, settings.productTypes.includes(kind));
  }

  element<HTMLInputElement>('categoryFilter').value = settings.categoryFilter ?? '';
  element<HTMLInputElement>('maxPages').value = String(settings.maxPages);
  element<HTMLSelectElement>('contentMode').value = settings.contentMode;
  element<HTMLInputElement>('currencyCode').value = settings.currency.code;
  element<HTMLSelectElement>('displayUnit').value = settings.currency.displayUnit;
  element<HTMLInputElement>('delayMs').value = String(settings.politeness.delayMsBetweenRequests);
  element<HTMLInputElement>('maxConcurrent').value = String(settings.politeness.maxConcurrent);
  element<HTMLInputElement>('aiEnabled').checked = settings.aiProvider.enabled;
  element<HTMLSelectElement>('aiProvider').value = settings.aiProvider.name;
  element<HTMLInputElement>('aiModel').value = settings.aiProvider.model;
  element<HTMLInputElement>('aiApiKey').value = await loadApiKey();

  element('settings').addEventListener('change', () => {
    void persistSettings();
  });
}

const STATUS_TEXT: Record<string, string> = {
  complete: 'Read the whole category.',
  'budget-reached': 'Stopped at the page limit — scan again to carry on.',
  'needs-browser': 'This category loads more as you scroll; only the loaded products were read.',
  blocked: 'The site blocks automated reading. The scan stopped.',
  running: 'Still running.',
};

function describeTab(tab: Tab): string {
  try {
    const url = new URL(tab.url ?? '');
    return `${url.hostname}${url.pathname}`;
  } catch {
    return 'No page open.';
  }
}

function originPattern(url: string): string | undefined {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return undefined;
  }
}

function row(label: string, value: string): void {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  detail.append(dt, dd);
}

function render(summary: ScanSummary): void {
  counts.classList.add('shown');
  detail.replaceChildren();
  issueList.replaceChildren();

  const products = summary.productCount;
  headline.textContent = `${String(products)} product${products === 1 ? '' : 's'}`;

  const small = document.createElement('small');
  small.textContent =
    `${String(summary.rowCount)} CSV rows, including ${String(summary.variationCount)} variation` +
    `${summary.variationCount === 1 ? '' : 's'}`;
  headline.append(small);

  const READ_FROM: Record<string, string> = {
    A: `${summary.platform} API`,
    B: 'page markup',
    C: 'the profile you taught',
  };
  row('Read from', READ_FROM[summary.layer] ?? summary.layer);
  row('Pages', String(summary.pagesScanned));
  if (summary.requests > 0) row('Requests', String(summary.requests));
  if (summary.duplicates > 0) row('Duplicates merged', String(summary.duplicates));
  if (summary.resumed) row('Resumed', 'carried on from a saved scan');

  const units = Object.entries(summary.currencyUnits);
  if (units.length > 0) {
    row('Prices', units.map(([unit, count]) => `${String(count)} ${unit}`).join(', '));
  }

  // The unit only has to be *asked* about when the pages did not say. An
  // unstated IRR price is an unanswered question, and answering it wrongly is a
  // 10x error, so the choice is put in front of the user before the file is
  // written rather than defaulted behind their back (CLAUDE.md §7.8).
  const unstated = summary.currencyUnits['unknown'] ?? 0;
  const stated = summary.currencyUnits['toman'] ?? summary.currencyUnits['rial'];
  unitRow.hidden = unstated === 0;
  if (stated !== undefined && summary.currencyUnits['rial'] !== undefined) {
    unitSelect.value = 'rial';
  }

  scannedUrl = summary.url;
  exportBox.hidden = summary.rowCount === 0;

  statusLine.textContent = STATUS_TEXT[summary.status] ?? summary.status;

  for (const issue of summary.issues) {
    const item = document.createElement('li');
    item.className = issue.severity;
    item.textContent = issue.message;
    issueList.append(item);
  }

  rescanButton.hidden = false;
}

async function activeTab(): Promise<Tab | undefined> {
  const [tab] = await tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scan(restart: boolean): Promise<void> {
  const tab = await activeTab();
  if (tab?.id === undefined || tab.url === undefined) {
    statusLine.textContent = 'No page to scan.';
    return;
  }

  const pattern = originPattern(tab.url);
  if (pattern === undefined) {
    statusLine.textContent = 'This page cannot be scanned.';
    return;
  }

  // Asked here, inside the click, because that is the only place Chrome allows
  // it. Declining is a normal answer, not an error.
  let canFetch = await permissions.contains({ origins: [pattern] });
  if (!canFetch) {
    canFetch = await permissions.request({ origins: [pattern] });
  }

  scanButton.disabled = true;
  rescanButton.disabled = true;
  statusLine.textContent = canFetch
    ? 'Scanning…'
    : 'Scanning this page only — permission for the rest of the site was declined.';

  try {
    const response = await runtime.sendMessage<unknown, ExtensionResponse>({
      kind: 'scan',
      tabId: tab.id,
      url: tab.url,
      canFetch,
      restart,
    });

    if (!response.ok) {
      statusLine.textContent = response.message;
      return;
    }
    if (response.kind === 'summary' && response.summary !== undefined) render(response.summary);
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    scanButton.disabled = false;
    rescanButton.disabled = false;
  }
}

/**
 * Hand the file to the browser.
 *
 * The blob is made here rather than in the worker because a service worker has
 * no `URL.createObjectURL`. The object URL is revoked once the click has been
 * dispatched, so the CSV does not sit in memory after the download starts.
 */
function saveFile(filename: string, csv: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([csv], { type });
  const href = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 10_000);
}

async function download(): Promise<void> {
  if (scannedUrl === undefined) return;

  downloadButton.disabled = true;
  statusLine.textContent = 'Building the CSV…';

  try {
    const response = await runtime.sendMessage<unknown, ExtensionResponse>({
      kind: 'export',
      url: scannedUrl,
      displayUnit: unitSelect.value as CurrencyUnit,
    });

    if (!response.ok) {
      statusLine.textContent = response.message;
      return;
    }
    if (response.kind !== 'download') return;

    saveFile(response.download.filename, response.download.csv);

    const warnings = response.download.warnings.length;
    statusLine.textContent =
      `Saved ${String(response.download.rowCount)} rows` +
      (warnings === 0 ? '.' : ` with ${String(warnings)} warning${warnings === 1 ? '' : 's'}.`);

    for (const warning of response.download.warnings.slice(0, 4)) {
      const item = document.createElement('li');
      item.className = 'warning';
      item.textContent = warning.message;
      issueList.append(item);
    }
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    downloadButton.disabled = false;
  }
}

downloadButton.addEventListener('click', () => {
  void download();
});

/**
 * "Why is this field empty?" (CLAUDE.md §11).
 *
 * The summary goes into the popup, because most of the time it is the whole
 * answer and nobody should have to open a file to read one sentence. The full
 * report and the structured log are downloaded together — the report is for the
 * user, the log is for whoever they send it to.
 */
async function explain(): Promise<void> {
  if (scannedUrl === undefined) return;

  explainButton.disabled = true;
  statusLine.textContent = 'Working out what happened…';

  try {
    const tab = await activeTab();
    const response = await runtime.sendMessage<unknown, ExtensionResponse>({
      kind: 'report',
      url: scannedUrl,
      // Sent only when the tab still shows the page that was scanned; a profile
      // health check against a different page would be nonsense.
      ...(tab?.id !== undefined && tab.url === scannedUrl ? { tabId: tab.id } : {}),
    });

    if (!response.ok) {
      statusLine.textContent = response.message;
      return;
    }
    if (response.kind !== 'report') return;

    saveFile(response.report.filename, response.report.text, 'text/plain;charset=utf-8');
    saveFile(
      response.report.filename.replace(/\.txt$/, '.log.jsonl'),
      response.report.log,
      'application/json;charset=utf-8'
    );
    statusLine.textContent = response.report.summary;
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    explainButton.disabled = false;
  }
}

explainButton.addEventListener('click', () => {
  void explain();
});

/**
 * Teaching closes the popup on purpose: the picker runs in the page, and a
 * popup left open would steal the clicks meant for the product card.
 */
async function teach(): Promise<void> {
  const tab = await activeTab();
  if (tab?.id === undefined || tab.url === undefined) {
    statusLine.textContent = 'No page to teach.';
    return;
  }

  statusLine.textContent = 'Click the product name, price and image on the page…';
  void runtime
    .sendMessage<unknown, ExtensionResponse>({ kind: 'teach', tabId: tab.id, url: tab.url })
    .catch(() => undefined);

  // The result is read back the next time the popup opens; the picker needs
  // the page to itself until then.
  window.close();
}

teachButton.addEventListener('click', () => {
  void teach();
});

scanButton.addEventListener('click', () => {
  void scan(false);
});

rescanButton.addEventListener('click', () => {
  void scan(true);
});

void (async (): Promise<void> => {
  await renderSettings();

  const tab = await activeTab();
  pageLine.textContent = tab === undefined ? 'No page open.' : describeTab(tab);

  // The popup may have been closed while the last scan was still running.
  const response = await runtime
    .sendMessage<unknown, ExtensionResponse>({ kind: 'last-result' })
    .catch(() => undefined);

  if (response?.ok === true && response.kind === 'summary' && response.summary !== undefined) {
    // Only if it is about *this* page — a stale result from another tab would
    // be worse than none.
    if (response.summary.url === tab?.url) {
      render(response.summary);
      statusLine.textContent = `${STATUS_TEXT[response.summary.status] ?? ''} (last scan)`;
    }
  }
})();
