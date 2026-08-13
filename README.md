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
| 2     | Layer B — structured markup (JSON-LD → Microdata → OpenGraph) | next    |
| 3     | Layer A — WooCommerce Store API, then Shopify                 |         |
| 4     | Category traversal / pagination                               |         |
| 5     | Variable products & variations                                |         |
| 6     | Layer C — Selector Learning Mode                              |         |
| 7     | Filtering & field selection                                   |         |
| 8     | Layer D — pluggable AI providers                              |         |
| 9     | Troubleshooting subsystem                                     |         |
| 10    | Cross-platform packaging                                      |         |
| 11    | Release automation                                            |         |
| 12    | Additional exporters                                          |         |

There is no browser extension yet, and nothing here talks to the network. What
exists is the part everything else is validated against: the canonical product
model, the normalizers, and a WooCommerce CSV exporter with 189 tests behind it.

## Packages

| Package              | What it is                                                            |
| -------------------- | --------------------------------------------------------------------- |
| `packages/core`      | `CanonicalProduct`, number/money/text normalizers, deterministic SKUs |
| `packages/exporters` | WooCommerce CSV exporter (Shopify CSV and JSON to follow)             |

`packages/extension`, `packages/companion` and `packages/profiles` arrive with
the phases that need them.

## Getting started

```bash
npm install
npm run check     # format check, lint, typecheck, test
npm test
```

Node 20.11+ required. Packages are consumed straight from TypeScript source;
nothing emits to `dist` yet, because the extension and companion will bundle
from source when Phase 10 packaging lands.

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

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) — they will drive
versioning once release automation lands in Phase 11.

Run `npm run check` before pushing; CI runs the same thing.
