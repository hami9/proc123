# proc123

**Scan any online store's category page, get a CSV that imports cleanly into another store.**

proc123 reads a category or collection page on any e-commerce platform, extracts
every product on it — simple and variable, with all variations — normalizes them
into one platform-neutral model, and exports a CSV built for a specific target
store. WooCommerce first, Shopify next.

See [`CLAUDE.md`](CLAUDE.md) for the full design brief and [`ROADMAP.md`](ROADMAP.md)
for the phase plan.

---

## Status

Early. Built in the order set out in `CLAUDE.md` §14 — the hardest correctness
problem first, the browser UI last.

| Phase |                                                               |         |
| ----- | ------------------------------------------------------------- | ------- |
| 0     | Monorepo scaffold + CI                                        | ✅ done |
| 1     | Canonical model + WooCommerce CSV exporter                    | ✅ done |
| 2     | Layer B — structured markup (JSON-LD → Microdata → OpenGraph) | ✅ done |
| 3     | Layer A — WooCommerce Store API, then Shopify                 | ✅ done |
| 4     | Category traversal / pagination                               | ✅ done |
| 5     | Variable products & variations                                | partial |
| 6     | Layer C — Selector Learning Mode                              | ✅ done |
| 7     | Filtering & field selection                                   | ✅ done |
| 8     | Layer D — pluggable AI providers                              | ✅ done |
| 9     | Troubleshooting subsystem                                     | next    |
| 10    | Cross-platform packaging                                      |         |
| 11    | Release automation                                            |         |
| 12    | Additional exporters                                          |         |

`core` still makes no requests of its own — you supply the HTML and, for Layer
A, an HTTP client; the extension and the companion own the network. What exists
is the part everything else is validated against: the canonical product model,
the normalizers, both extraction layers,
a WooCommerce CSV exporter, and a loadable browser extension, with 598 tests
behind them.

## Packages

| Package              | What it is                                                                  |
| -------------------- | --------------------------------------------------------------------------- |
| `packages/core`      | `CanonicalProduct`, normalizers, SKUs, Layer A + Layer B, category crawling |
| `packages/exporters` | WooCommerce CSV exporter (Shopify CSV and JSON to follow)                   |
| `packages/extension` | Manifest V3 extension: popup, service worker, CSV download                  |
| `packages/profiles`  | Site profile schema — the JSON Layer C learns and a person can edit         |

`packages/companion` arrives with the phase that needs it.

## Running the extension

```bash
npm install
npm run build -w @proc123/extension
```

Then load `packages/extension/dist` in `chrome://extensions` with developer mode
on. Open a store's category page, click the toolbar button, and press **Scan
this category**.

`activeTab` covers reading the page you already have open. Permission for the
rest of the site is asked for separately and only used to fetch the _other_
pages of the category — declining it scans the open page and says so. The
service worker owns every request; the content side only ever reads the DOM.

Before writing a file the popup shows how the prices were quoted. When the pages
tagged prices `IRR` without saying toman or rial, it asks which they are, rather
than picking one — that is the 10× error this project is most careful about.

## Getting started

```bash
npm install
npm run check     # format check, lint, typecheck, test
npm test
```

Node 20.11+ required. `core` and `exporters` are consumed straight from
TypeScript source; only the extension bundles, because a browser cannot run
TypeScript. Signing and cross-browser manifests land with Phase 10.

## Scanning a page

`scanCategory` runs the whole pipeline: detect the platform, try its own
catalogue endpoint, and fall back to reading the page's markup.

```ts
import { scanCategory } from '@proc123/core';
import { exportWooCommerceCsv } from '@proc123/exporters';

const scan = await scanCategory({ url: pageUrl, html }, { http });

scan.layer; // 'A' when the store's own API answered, 'B' when the page did
scan.platform; // 'woocommerce' | 'shopify' | 'nextjs' | … | 'unknown'
scan.detections; // every platform signal that fired, and how confident it was
scan.incomplete; // the scan knows it did not see the whole category

const { csv } = exportWooCommerceCsv(scan.products);
```

`http` is a one-function client the caller supplies — the extension backs it with
its background service worker, the companion with Node, tests with canned
responses. Without one, only the layers needing no network run.

### Layer A — the store's own catalogue

| Platform       | Endpoint                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| WooCommerce    | `/wp-json/wc/store/v1/products` — paginated and category-filtered, plus one call per variable product for real per-variation prices |
| Shopify        | `/collections/{handle}/products.json` — **unofficial**, so the result is cross-checked against the collection's declared count      |
| Next.js / Nuxt | `__NEXT_DATA__`, `__NUXT__`, Apollo caches — read straight out of the page, no request at all                                       |

Where it exists, Layer A beats markup on every axis: complete variations, real
stock, and the store's own currency settings — which is how a Store API scan
tells toman from rial without having to ask.

Magento, PrestaShop and OpenCart are detected but have no adapter yet. The scan
says so and reads the page instead, rather than falling through in silence.

### When a site says no

Scans are paced and low-concurrency by default (800ms apart, two at a time). If
a site answers with a CAPTCHA, a 403 or a 429, the scan **stops**: the client
latches, every later request throws without being sent, and the result carries a
`site-blocked` error naming what happened. There is no retry, no backoff, and no
fallback that reads the same site by another route. See
[what proc123 will not do](#what-proc123-will-not-do).

## Crawling a whole category

`scanCategory` reads one page. `crawlCategory` follows the pagination:

```ts
import { crawlCategory, createMemoryCrawlStore } from '@proc123/core';

const crawl = await crawlCategory({ url, html }, { http, store, maxPages: 20 });

crawl.products; // deduplicated across every page
crawl.duplicates; // sightings folded into an earlier one
crawl.state.status; // complete | budget-reached | needs-browser | blocked
```

Four pagination strategies are detected rather than assumed, because assuming
one is how a scanner returns the first twenty-four products of a
two-hundred-product category and calls it done: `rel="next"`, numbered navs,
"load more" buttons, and infinite scroll. Next pages are followed link by link
rather than by guessing a URL template — a template built from
`/category/2024/page/2/` has two numbers to choose between.

Two of those four are interactions, not URLs. When a "load more" button or an
infinite scroller publishes no URL to follow, the crawl says
`status: 'needs-browser'` instead of pretending the category ended.

**Progress is persisted after every page.** An MV3 service worker is killed when
idle, and a twenty-page scan at 800ms a page will outlive one — so `store` (any
`CrawlStore`; `chrome.storage` in the extension) lets the next run resume rather
than start again. Starting again would double the load on the store being read.

Products are deduplicated by canonical URL _and_ SKU, because pagination and
infinite scroll overlap constantly. When the same product is seen twice, the two
sightings are merged field by field, keeping whichever was recorded with more
confidence.

### Layer C — teaching it a store

When a storefront publishes nothing machine-readable at all, the user clicks the
product name, price and image on **one** card and proc123 works out the rest:

```ts
const learned = learnProfile(loadHtml(html), picks, { url });
const result = extractWithProfile(page, learned.profile, options);
```

The card is found by looking for **repetition** — a product card is by
definition the thing there are lots of, so the lowest ancestor of the clicks
that has siblings shaped like itself is it. That works on every platform,
because it uses the one fact true of every storefront.

Selectors are scored by how much _meaning_ they carry, not by how short they
are. `[itemprop="name"]` is the store telling us what an element is;
`.product-title` is a developer saying so; `.css-1a2b3c` is a build tool saying
nothing, and is never offered as a candidate. A position is used only when
nothing else identifies the element — and the profile says so in words, because
that is the rule to check first when it stops working.

The product **link is found, not asked for**. Three clicks is the promise, and a
product with no URL cannot be told apart from its neighbours — SKUs are derived
from it and the crawl deduplicates on it.

Profiles are plain JSON keyed by domain, so teaching one category page covers
the whole store. `checkProfileHealth` reports selectors that have stopped
matching, and distinguishes "missing everywhere" (broken) from "missing on some
cards" (usually normal).

### Layer B — structured markup

Reads what SEO obliges stores to publish, so it works on any platform without
knowing which one it is:

```ts
import { extractStructured } from '@proc123/core';

const result = extractStructured({ url: pageUrl, html });

result.products; // CanonicalProduct[] — parents immediately before their variations
result.discoveredUrls; // product links the page listed but did not describe
result.issues; // every parse failure, assumption and skipped field, with a reason

const { csv } = exportWooCommerceCsv(result.products);
```

Three sources are read in order and merged by confidence: **JSON-LD** (including
`@graph`, `@id` references, `ItemList`, `BreadcrumbList` and `ProductGroup` with
`hasVariant`), then **Microdata**, then **OpenGraph** `product:*` tags. A source
lower down fills gaps but never overrules one above it, and every field carries
the confidence it was recorded with in `extractionMeta.fieldConfidence`.

`parseSitemap` reads `sitemap.xml` and sitemap indexes for product-URL discovery.
Fetching is not done here — the extension and companion own the network,
including the delay between requests.

### What Layer B will not do

- It does not invent a product from an `<h1>` and a price `<div>`. A page with no
  structured markup produces zero rows and a `no-structured-data` issue pointing
  at Selector Learning Mode (Phase 6).
- A product with no name is skipped, not exported blank.
- An `AggregateOffer` price _range_ is recorded as the low end with reduced
  confidence and an issue naming both bounds, so a later per-product scan
  replaces it rather than fighting it.
- A regular and a sale price move together or not at all. Pairing one source's
  regular price with another's sale price is how a product ends up permanently
  marked down to exactly its own price.

## Settings

Everything lives in one `Proc123Config` — the shape from `CLAUDE.md` §9 — and
everything in it is settable from the popup, because most users will never open
the JSON:

```ts
const { config, problems } = parseConfig(json);
const scan = await scanCategory(page, { ...configToScanOptions(config), http });
const { products, issues } = applyConfig(scan.products, config);
```

`targetFields` decides which columns carry data, `productTypes` which products
are kept, `categoryFilter` accepts `آجیل > گردو` or just `گردو`. Anything the
config cannot use is **reported rather than ignored** — a typo that silently
does nothing is worse than one that says so — and the defaults are kept instead
of the scan failing.

Two rules the filters enforce:

- **A variation follows its parent.** Dropping a variable product while keeping
  its variations leaves rows whose `Parent` column points at nothing, which the
  exporter then discards with a warning the user never caused. Asking for only
  `variable` keeps that product's variations too, since a variable product
  without them imports as something nobody can buy.
- **`name` cannot be turned off**, and a config that omits it gets it back with
  an explanation. No row can be exported without one.

An `apiKey` in a config file is refused and reported. Keys belong in extension
settings, not in a file that gets shared or committed (§4).

## Using the exporter

```ts
import { exportWooCommerceCsv } from '@proc123/exporters';

const result = exportWooCommerceCsv(products, {
  displayUnit: 'toman', // toman or rial — prices are converted, never guessed
  weightUnit: 'kg', // must match the target store's settings
  contentMode: 'structured-only',
});

result.csv; // the file, UTF-8 with BOM
result.stats.currencyUnits; // { toman: 42, unknown: 3 } — show before exporting
result.warnings; // every assumption and repair, with SKU and source URL
```

The result is deliberately more than a string. `stats.currencyUnits` is what a
UI shows the user to confirm the toman/rial toggle _before_ writing a file, and
`warnings` carries every place the exporter had to assume or repair something.

### What the exporter guarantees

Each of these is a test in `packages/exporters/test/woocommerce.test.ts`:

- **Canonical English headers.** They auto-map on a store in any locale, because
  WooCommerce ships an English fallback mapping applied regardless of locale.
  Localized headers are opt-in via `headerOverrides`.
- **Variations link to parents by SKU, never by ID.** WooCommerce always assigns
  its own IDs; source IDs do not survive an import.
- **Deterministic SKUs.** `P123-{hash(canonical source URL)}` for parents,
  `{parentSku}-{slug(values)}` for variations. Re-scanning a catalogue produces
  identical SKUs, so a re-import updates rather than duplicates. Tracking
  parameters are stripped before hashing. Every row gets a unique SKU.
- **Each parent row immediately precedes its own variation rows.** Not
  cosmetic — a variation ahead of its parent silently imports with no attributes.
- **Variable parents carry empty price cells.** Empty, not `0`.
- **Attribute columns sized to the widest product**, parent listing all values
  and each variation exactly one, matching character for character.
- **`Attribute N global` defaults to `0`.** Global attributes need the taxonomy
  to already exist on the target store.
- **Numbers normalized.** Persian/Arabic-Indic digits to ASCII, separators
  stripped, `.` for decimals, and explicit toman ↔ rial handling. Weights and
  dimensions are converted into the target store's units.
- **UTF-8 with BOM.**

### The toman/rial rule

A silent 10× price error is the worst thing this tool could ship, so the unit is
never inferred from the currency code. Iranian stores routinely tag toman prices
as `IRR` in their markup, so `IRR` tells us the currency and nothing about the
unit. `Money.unit` is set only from an explicit word on the page.

When a price reaches the exporter with no unit, it is written unchanged, counted
under `stats.currencyUnits.unknown`, and reported as a `currency-unit-assumed`
warning naming the 10× risk. Set `strictCurrencyUnit: true` to make the export
throw instead.

### Content mode

Structured data — SKUs, prices, stock, weights, attributes, category structure —
is what this tool moves. Descriptions and photographs are authored content owned
by whoever produced them, and republishing them verbatim carries both legal
exposure and a duplicate-content SEO penalty that usually lands on the copy.

`contentMode` defaults to `structured-only`: data fields are copied, description
columns are left empty. `reference` includes descriptions and tags every row
with its source URL for review. `rewrite` will pass them through the configured
AI provider once Layer D lands.

## The AI fallback (Layer D)

Off by default, and it stays off until you paste your own API key. When it is
on, it runs only for products the markup could not describe — never as a first
resort — and it is sent a **trimmed fragment of the page**, not the page:
scripts, menus, footers and related-product carousels are stripped first, which
cuts the bill and stops the model reading a neighbouring product's price.

Everything it returns is checked back against that fragment before it is used. A
price whose digits do not appear, an image URL that is not in the markup, a
category invented out of nowhere — all discarded, with a line in the report
saying so. A model will always answer; the point of the check is that only
answers actually supported by the page survive it.

Gemini, OpenAI and Claude are supported, each through its own structured-output
mode with a strict JSON schema, and every scan reports the tokens it spent. Your
key is stored in the browser only and is deliberately kept out of
`proc123.config.json`, so exporting or sharing your settings cannot leak it.

## Fields you will not get

The WooCommerce export format has hundreds of columns. Many cannot be obtained
from outside the source store, and proc123 leaves them empty rather than
inventing values:

- **Tier 1 — always attempted:** type, name, regular/sale price, categories,
  images, descriptions, stock status, parent link, attribute names and values.
- **Tier 2 — best effort:** weight, dimensions, tags, brand, GTIN, tax class.
  Present only when the source page publishes them.
- **Tier 3 — not obtainable:** every `meta: woodmart_*`, `meta: rank_math_*` and
  `meta: _elementor_*` column. These live in the source store's database and are
  never rendered in another store's HTML. They are left empty, never fabricated.

Two columns proc123 can emit are **not** auto-mapped by WooCommerce's importer
and need mapping by hand in the import wizard, so they are opt-in:
`GTIN, UPC, EAN, or ISBN` (`includeGtin`) and `Brands` (`includeBrand`).

A note on Excel: the file is UTF-8 with a BOM so Excel opens it correctly, but
editing and re-saving in Excel can corrupt it. Prefer LibreOffice, or import the
file directly.

## What proc123 will not do

proc123 runs inside your own browser session, on pages you have already opened.
It does not, and will never:

- solve or bypass CAPTCHAs
- spoof browser fingerprints or apply "stealth" patches
- rotate proxies or IPs to evade blocking
- retry past an active block

When a site signals that it blocks automated reading, proc123 stops the scan,
logs it, and tells you. This is permanent and applies to every phase.

## Documentation

- [`docs/woocommerce-csv-notes.md`](docs/woocommerce-csv-notes.md) — WooCommerce
  importer behaviour verified against its source, with references. Worth reading
  before changing the exporter.
- [`docs/store-api-notes.md`](docs/store-api-notes.md) — the WooCommerce Store
  API verified the same way: minor-unit prices, the variation slug trap, and the
  category parameter that guesses what you meant.
- [`docs/structured-markup-notes.md`](docs/structured-markup-notes.md) — what
  storefronts actually publish as JSON-LD, Microdata and OpenGraph, and the
  decisions Layer B makes about it.

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) — they will drive
versioning once release automation lands in Phase 11.

Run `npm run check` before pushing; CI runs the same thing.
