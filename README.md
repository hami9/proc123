<div align="center">

<img src="docs/logo.png" alt="proc123" width="160" height="160" />

# proc123

**Scan any online store's category page. Get a CSV that imports cleanly into another store.**

<!-- version-badge:start -->

[![version](https://img.shields.io/badge/version-1.5.0-7a3e1d)](https://github.com/hami9/proc123/releases/tag/v1.5.0)
<!-- version-badge:end -->

[![CI](https://github.com/hami9/proc123/actions/workflows/ci.yml/badge.svg)](https://github.com/hami9/proc123/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-7a3e1d)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520.11-7a3e1d)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-800-7a3e1d)](#getting-started)

[Install on Windows](docs/install-windows.md) &nbsp;·&nbsp; [How it works](#scanning-a-page) &nbsp;·&nbsp; [What it will not do](#what-proc123-will-not-do) &nbsp;·&nbsp; [Contributing](CONTRIBUTING.md)

</div>

---

proc123 reads a category or collection page on any e-commerce platform, extracts
every product on it — simple and variable, with all variations — normalizes them
into one platform-neutral model, and exports a CSV built for a specific target
store. **WooCommerce**, **Shopify**, or plain **JSON**.

It runs in your own browser session, on pages you already have open. No proxies,
no CAPTCHA solving, no pretending to be someone else.

```
  a category page          four extraction layers            a file another
  you already have    →    first one that answers wins   →   shop can import
  open in a tab

                     ┌── A · the shop's own catalogue API ──┐
                     ├── B · structured markup (JSON-LD…) ──┤
                     ├── C · a layout you taught it ────────┤
                     └── D · AI, off until you opt in ──────┘
```

## Install

**Just want to use it?** Grab the
[latest release](https://github.com/hami9/proc123/releases/latest) — nothing to
build, no Node required.

| You are on             | Download                                       | Then                                                                 |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| **Windows**            | either asset below                             | follow the **[step-by-step Windows guide](docs/install-windows.md)** |
| Chrome · Edge · Brave  | `proc123-chrome-<version>.zip`                 | unzip → `chrome://extensions` → Developer mode → Load unpacked       |
| Firefox                | `proc123-firefox-<version>.zip`                | `about:debugging` → Load Temporary Add-on → pick the zip itself      |
| A terminal, no browser | `proc123-win32-x64.exe` or `proc123-linux-x64` | `proc123 <category-url> -o products.csv`                             |

Then open a shop's category page, click the toolbar button, press **Scan this
category**, check the currency line, and press **Download**.

**Not in either store yet**, which is why the install is a folder rather than a
button. Chrome blocks extension files from anywhere but its own store, and
Firefox refuses any add-on it has not signed — neither is something the package
can work around, so loading it as a developer is the supported route until the
listings exist. [`docs/publishing.md`](docs/publishing.md) covers what that
takes, in the order that gets a real install to people soonest, and what is
already in place for it.

> **Firefox: use `about:debugging`, not `about:addons`.** The Add-ons Manager
> only accepts a Mozilla-signed file and will reject the zip as unverified.
> `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** takes the
> zip as it is, and lasts until you close the browser.

Building it yourself is under [Getting started](#getting-started).

---

## Status

Usable. Built hardest-correctness-problem first, browser UI last — which is why
the exporters and the extraction layers are the most heavily tested part and the
popup is the newest.

<!-- phase-table:start -->

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
| 9     | Troubleshooting subsystem                                     | ✅ done |
| 10    | Cross-platform packaging                                      | ✅ done |
| 11    | Release automation                                            | ✅ done |
| 12    | Additional exporters                                          | ✅ done |
| 13    | Inspector engine — technologies, fonts, images                | ✅ done |
| 14    | Inspector in the extension                                    | next    |
| 15    | App shell — Windows and Linux (Tauri v2)                      |         |
| 16    | The app scans on its own                                      |         |
| 17    | Bridge — app ↔ extension over loopback                        |         |
| 18    | Android                                                       |         |
| 19    | Visual picker for any field                                   |         |
| 20    | Packaging and distribution                                    |         |

<!-- phase-table:end -->

Phases 13–20 add an inspector — what built this site, which fonts, which images
— and an application for Windows, Linux and Android built on the same engine,
with the extension kept and improved rather than replaced.
[`docs/roadmap.md`](docs/roadmap.md) is the plan and [`CLAUDE.md`](CLAUDE.md)
§15–§18 is the design.

`core` still makes no requests of its own — you supply the HTML and, for Layer
A, an HTTP client; the extension and the companion own the network. What exists
is the part everything else is validated against: the canonical product model,
the normalizers, all four extraction layers, three exporters, a browser
extension for Chrome and Firefox, and a command-line companion, with 800 tests
behind them.

Phase 13 added the inspector's engine to `core`, so it is there to build on but
**not yet something you can click** — the three views reach the popup in phase 14. It reads a document you already have and makes no requests of its own
either.

## Packages

| Package              | What it is                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/core`      | `CanonicalProduct`, normalizers, SKUs, Layer A + Layer B, category crawling, the inspector engine |
| `packages/exporters` | WooCommerce CSV, Shopify CSV and JSON exporters                                                   |
| `packages/extension` | Manifest V3 extension: popup, service worker, CSV download                                        |
| `packages/profiles`  | Site profile schema — the JSON Layer C learns and a person can edit                               |
| `packages/companion` | Command-line runner: the same pipeline, no browser                                                |

## Running the extension

```bash
npm install
npm run build -w @proc123/extension
```

That builds both browsers at once. Load `packages/extension/dist/chrome` in
`chrome://extensions` with developer mode on — or
`packages/extension/dist/firefox` via `about:debugging` → **This Firefox** →
**Load Temporary Add-on**, picking its `manifest.json`. Then open a store's
category page, click the toolbar button, and press **Scan this category**.

The JavaScript is identical for both. The manifests differ because they have to
— Firefox does not run extension service workers, and will not install an MV3
add-on without an add-on id — and the runtime difference between `chrome.*` and
`browser.*` is handled in one file, `src/browser.ts`. `npm run build:zip -w
@proc123/extension` produces the two store uploads.

`activeTab` covers reading the page you already have open. Permission for the
rest of the site is asked for separately and only used to fetch the _other_
pages of the category — declining it scans the open page and says so. The
service worker owns every request; the content side only ever reads the DOM.

Before writing a file the popup shows how the prices were quoted. When the pages
tagged prices `IRR` without saying toman or rial, it asks which they are, rather
than picking one — that is the 10× error this project is most careful about.

## Running it without a browser

```bash
npm run build -w @proc123/companion
node packages/companion/dist/proc123.js https://shop.example/category -o out.csv
```

Same layers, same politeness, same exporter, same resumable state — `core` is
platform-neutral precisely so there is only one implementation to get right.
`--report` and `--log` write the troubleshooting files; `--unit toman|rial`
answers the price question up front; Ctrl-C and re-run resumes where it stopped.

**It reads the HTML a server sends.** A shop that builds its catalogue in the
browser will look empty here, and the companion says so rather than reporting a
bare zero — that is the whole reason the extension exists. Use the extension for
those.

`npm run build:binary -w @proc123/companion` produces a single executable for
whoever has no Node installed. It is built for the machine that runs it; other
platforms are built on themselves.

## Getting started

```bash
npm install
npm run check     # format check, lint, typecheck, test
npm test
```

Node 20.11+ required. `core`, `exporters` and `profiles` are consumed straight
from TypeScript source; the extension and the companion each bundle at build
time, because neither a browser nor a single-file executable can run TypeScript.
Store signing is not automated yet; the release workflow attaches unsigned
artifacts.

## Releasing

Nobody edits a version by hand. Merging to `main` runs the checks, builds a
companion binary on each platform, and lets
[semantic-release](https://semantic-release.gitbook.io) work out the next
version from the commit messages — which is why
[Conventional Commits](https://www.conventionalcommits.org) are required rather
than encouraged. It then writes `CHANGELOG.md`, syncs the version into every
file that states one, and publishes a GitHub Release with the two extension zips
and both companion binaries attached.

`scripts/release/sync-version.mjs` is the part worth knowing about. A version
appears in four places — the root `package.json`, both extension manifests, and
the User-Agent a shop sees in its logs — and a store will happily accept an
upload whose manifest version did not change, which is a slow way to find out.
The same script regenerates the README's version badge and phase table from
`scripts/release/phases.json`, so phase status lives in one file instead of
being kept in step by hand. CI fails a pull request where those have drifted.

```bash
npm run release:check     # are the generated sections in step?
npm run release:dry-run   # what would the next release be?
```

Nothing is published to npm: every workspace is private, and what ships is the
extension zips and the binaries.

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

Everything lives in one `Proc123Config`, and
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
settings, not in a file that gets shared or committed.

## Using the exporters

Three of them, chosen by name from `proc123.config.json`, the popup, or the
companion's `--format`:

| Name              | What it produces                                                       |
| ----------------- | ---------------------------------------------------------------------- |
| `woocommerce-csv` | The default. Every rule below is under test.                           |
| `shopify-csv`     | Shopify's product CSV, matching the template Shopify itself publishes. |
| `json`            | Everything found, reshaped by nothing — see below.                     |

```ts
import { exportProducts } from '@proc123/exporters';

const { text, rowCount } = exportProducts(products, 'shopify-csv', {
  shopify: { displayUnit: 'toman' },
});
```

### Shopify is not WooCommerce with different headers

Its two price columns are **inverted**. WooCommerce has `Regular price` and an
optional `Sale price`; Shopify has `Price` — what the customer is actually
charged — and `Compare-at price`, the struck-through "was" figure. So a
discounted product writes its _sale_ price into `Price` and its _regular_ price
into `Compare-at price`.

Copying the WooCommerce mapping across produces a file where either every
product sells at its pre-discount price, or the whole shop appears permanently
discounted. Both import cleanly. Neither is noticeable until somebody buys
something.

Rows are not products either: one product is a run of rows sharing a handle —
the first carries the product-level fields and the first variant, later rows
carry further variants, and rows after those carry nothing but extra images.

Two defaults are deliberately cautious. Products import as **draft** and
unpublished, because a few hundred scanned products going live at prices nobody
has checked is not a thing a tool should do on your behalf; and inventory is
**not** tracked, because a scanned quantity is a snapshot of somebody else's
shop and Shopify would stop selling when that borrowed number ran out.

### JSON is for you, not for a shop

The CSVs answer "how does this shop want to be fed?". JSON answers "what did
proc123 actually find?" — for writing your own importer, diffing two scans, or
filing a bug about a field that came out wrong. It reshapes nothing: a price
whose toman/rial unit the page never stated keeps `unit` absent, because a CSV
has to pick one and that unanswered question is exactly what someone chasing a
10× error needs to see. It also carries the per-field confidence and layer the
CSVs have no column for. Keys are sorted, so two scans of the same shop diff
cleanly.

## Using the WooCommerce exporter

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

## Why is this field empty?

An empty column is usually not a bug, and telling the difference is the point of
the report behind the **Why is this field empty?** button. For every field it
says which of four things happened: you switched it off, the shop never
published it, it is one of the columns nobody can get from outside the shop, or
something actually went wrong — and only the last is worth reporting.

It also names where each value came from, in words rather than layer letters
("the shop's own product API", "the page's structured data"), flags a taught
layout whose selectors have stopped matching, and downloads a JSON-lines log
alongside it for whoever you ask for help. API keys and page content are never
written to that log, so it is safe to attach to an issue.

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

- [`docs/install-windows.md`](docs/install-windows.md) — installing and running
  it on Windows, click by click, with no Node and no build step.
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

Issues and pull requests are welcome — including "it returned nothing on this
shop", which is the most useful bug this project can get. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the short version: Conventional Commits
(they decide the next version number), and `npm run check` before pushing.

Security or privacy problems go to [SECURITY.md](SECURITY.md) instead of a
public issue.

## Contact and support

**Telegram — [@ham1235i](https://t.me/ham1235i)** for anything that is not a bug
report: questions, other projects, or a shop that will not scan and you would
rather not write up. Bugs are still better as issues, where the next person with
the same shop can find them.

**Sponsored by [kgkala.ir](https://kgkala.ir).** Supporting the project is
optional and changes nothing about it — every package is MIT, there is no paid
tier, no supporter build, and no feature behind a link.
[`docs/licensing.md`](docs/licensing.md) explains why that is a rule rather than
a current state of affairs, and records that a paid version was considered and
turned down.

## License

[MIT](LICENSE) © hami9.

Using it responsibly is on you. proc123 moves structured product data; the
descriptions and photographs on someone else's shop belong to whoever made them,
which is why `contentMode` leaves those columns empty unless you say otherwise.
Check the terms of the site you are reading, and read at the pace it asks for.
