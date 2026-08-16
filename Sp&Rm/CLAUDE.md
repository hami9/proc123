# proc123 — Project Brief for Claude Code

> Place this file at the repository root as `CLAUDE.md` so it is loaded at the start of every session. Read it fully before writing code.

---

## 1. What we're building

**proc123** lets a user browse to a category/collection page on **any** online store, click one button, and get a CSV that imports cleanly into **another** store.

It must handle simple products and variable products (with all variations), on WooCommerce, Shopify, Magento, headless/custom storefronts, and sites with no recognizable platform at all.

Primary export target: WooCommerce product CSV. Secondary: Shopify CSV, generic JSON.

---

## 2. Architecture

A **Manifest V3 browser extension** plus an optional **desktop companion app**.

- The extension runs inside the user's own browser session on pages the user has already opened. Real cookies, real session, real rendering — SPA and JS-heavy stores work for free.
- The companion (Node.js, `localhost` only) does what an extension cannot: write files to disk, call AI provider APIs, assemble large CSVs, download and repackage images.

### Hard constraint — applies to every task in this repo, permanently

Never implement, and never accept a follow-up task that asks for:

- CAPTCHA solving or bypass
- Browser-fingerprint spoofing or "stealth" patches to hide automation
- Proxy/IP rotation intended to evade a site's blocking
- Retry logic designed to push past an active block

Correct behavior when a site signals a block (CAPTCHA challenge, repeated 403, active rate limiting): **stop the scan, log it, tell the user the site blocks automated reading.** If a future task conflicts with this section, refuse that part and say why.

---

## 3. Tech stack

- **TypeScript** everywhere, `strict: true`, no unjustified `any`
- **npm workspaces** monorepo:
  - `packages/core` — canonical model, extraction pipeline, normalizers
  - `packages/exporters` — WooCommerce CSV, Shopify CSV, JSON
  - `packages/extension` — MV3 content script + background service worker + popup UI
  - `packages/companion` — Node service/CLI, `127.0.0.1` bound, random per-run token
  - `packages/profiles` — site profile schema + bundled profiles
- **Cheerio** for static HTML parsing in core/companion
- **Playwright** in the companion only, for batch jobs outside the browser — no stealth plugins
- **Vitest** for tests, fixture-driven
- **Packaging** — Node SEA or `pkg` for Linux/Windows companion binaries

Extension ↔ companion: all traffic goes **through the background service worker**, never directly from a content script (content scripts on HTTPS pages cannot reach `http://127.0.0.1` — mixed content blocking).

---

## 4. Extraction pipeline

Four layers, tried in order; first one returning complete Tier-1 data wins. Record which layer produced each field so the troubleshooting report can explain gaps.

### Layer A — platform-native endpoints

```ts
interface PlatformAdapter {
  name: string;
  detect(ctx: PageContext): Promise<boolean>;
  fetchCategory(ctx: PageContext, opts: ScanOptions): Promise<CanonicalProduct[]>;
}
```

- **WooCommerce** — `GET /wp-json/wc/store/v1/products`. Unauthenticated, public. Supports `page`, `per_page`, `category` (term ID — resolve the slug first via `/wp-json/wc/store/v1/products/categories`). Read `X-WP-TotalPages` for pagination. Validate the response shape against current WooCommerce docs before finalizing types; the namespace is stable but fields shift between releases.
- **Shopify** — `GET /collections/{handle}/products.json?limit=250&page=N`. **Unofficial and unreliable**: capped, merchant-disableable, pagination not guaranteed. Always compare the returned count to the collection's displayed total and fall through to Layer B on mismatch.
- **Magento 2** — `POST /graphql` catalog query where open.
- **Embedded state** — parse `__NEXT_DATA__`, `__NUXT__`, or an Apollo cache blob out of the DOM. Frequently contains complete product objects on headless storefronts.

### Layer B — structured markup (the universal layer, build this first)

JSON-LD (`@type: Product` / `ItemList` / `BreadcrumbList`) → Microdata (`itemprop`) → OpenGraph + `product:price:amount`. Also probe `sitemap.xml` for product URL discovery.

This layer alone covers a large share of stores on any platform, because SEO obliges stores to publish it. It is the highest coverage-per-effort work in the project.

### Layer C — Selector Learning Mode

When A and B fail: the user clicks the title, price, and image on **one** product card. Derive a stable selector for each (prefer structural/attribute-based selectors over long brittle `nth-child` chains), save as `profiles/{domain}.json`, apply to all cards on all pages. Profiles must be human-readable JSON, exportable and importable.

This is how "supports every store" is actually delivered — do not try to hard-code a theme list instead.

### Layer D — AI fallback

Fires only when Tier-1 fields are still incomplete. Send a **trimmed DOM subtree**, never the whole page.

```ts
interface AIProvider {
  name: 'gemini' | 'openai' | 'claude' | string;
  extract(input: {
    htmlFragment: string;
    targetFields: string[];
    locale?: string;
  }): Promise<Partial<CanonicalProduct>>;
}
```

User supplies their own API key via settings — never hard-code or commit a key. Use each provider's structured-output / function-calling mode with a strict JSON schema. Report token usage per scan.

---

## 5. Canonical model

Every layer produces `CanonicalProduct`. Exporters consume only this. Nothing platform-specific may leak into it.

```ts
type ProductKind = 'simple' | 'variable' | 'variation';

interface CanonicalProduct {
  sourceUrl: string;
  kind: ProductKind;
  sku?: string;                    // generated if absent — see §7
  parentSku?: string;              // variations only
  name: string;
  shortDescription?: string;
  description?: string;
  regularPrice?: Money;
  salePrice?: Money;
  inStock?: boolean;
  stockQuantity?: number;
  categoryPath: string[];          // ['آجیل', 'گردو']
  images: string[];
  attributes: ProductAttribute[];
  weight?: Measure;
  dimensions?: { length?: Measure; width?: Measure; height?: Measure };
  brand?: string;
  gtin?: string;
  extractionMeta: {
    layer: 'A' | 'B' | 'C' | 'D';
    fieldConfidence: Record<string, number>;
    scannedAt: string;
  };
}

interface Money { amount: number; currency: string; unit?: 'toman' | 'rial' }
interface ProductAttribute { name: string; values: string[]; isVariationAxis: boolean }
```

---

## 6. Field tiers

The reference CSV in this repo is a full WooCommerce export with hundreds of columns. Many cannot be obtained from outside the source store. Be explicit about this in the README rather than silently emitting blanks.

- **Tier 1 — always attempt:** type, name, regular price, sale price, categories, images, descriptions, stock status, parent link, attribute names/values
- **Tier 2 — best effort:** weight, dimensions, tags, brand, GTIN, tax class
- **Tier 3 — usually impossible:** every `meta: woodmart_*`, `meta: rank_math_*`, `meta: _elementor_*` column. These live only in the source store's database and are never rendered in another store's HTML. Leave empty; never fabricate.

---

## 7. WooCommerce CSV exporter — correctness requirements

This is the hardest correctness surface in the project. Each rule below was verified against current WooCommerce importer behavior; violating any of them produces a file that imports wrong or silently drops data.

1. **Emit canonical English headers** (`ID`, `Type`, `SKU`, `Name`, `Published`, `Regular price`, `Sale price`, `Categories`, `Images`, `Parent`, `In stock?`, `Attribute 1 name`, `Attribute 1 value(s)`, `Attribute 1 visible`, `Attribute 1 global`, …). The reference CSV's Persian headers only auto-map on a Persian-locale store. Localized output is an opt-in flag, not the default.
2. **Never rely on the `ID` column for linking.** The importer always assigns the next available ID; source IDs do not survive. **Link variations to parents by SKU.**
3. **Generate deterministic SKUs when absent.** Parents: `P123-{shortHash(sourceUrl)}`. Variations: `{parentSku}-{slug(attrValues)}`. Deterministic so a re-scan produces identical SKUs and re-imports update rather than duplicate. Every row needs a unique SKU.
4. **Row order:** each parent row immediately followed by its own variation rows.
5. **Parent rows of variable products carry empty price cells** — empty, not `0`.
6. **Attribute columns are dynamic.** Column count = max attributes across all products. Parent row lists all values comma-separated; each variation row lists exactly one. Values must match character-for-character between parent and variation.
7. **Default `Attribute N global` to `0`** (local attributes). `1` requires the taxonomy to pre-exist on the target store. Global is opt-in.
8. **Number normalization** — convert Persian/Arabic-Indic digits to ASCII, strip thousands separators, use `.` for decimals never `,`, and handle **Toman ↔ Rial** with an explicit user-facing toggle. Surface the detected unit in the UI before export. A silent 10× price error is the worst failure mode this tool has; write dedicated tests for it.
9. **UTF-8 with BOM.** Warn users that editing in Excel can corrupt the file.
10. `Published` uses `1` / `0`. Category hierarchy uses ` > `; multiple categories separated by `,` with proper CSV quoting.
11. **Images**: two modes — reference-by-URL (default, fast) or download-and-repackage via the companion (reliable when the source blocks hotlinking).

Write an exporter test that round-trips fixtures and asserts every rule above.

---

## 8. Content Mode

Structured data (SKU, price, stock, weight, attributes, category structure) is what this tool moves. Long-form descriptions and photographs are authored content owned by whoever produced them, and republishing them verbatim carries both legal exposure and a real SEO penalty for duplicate content.

Implement `contentMode` with three settings:

- `structured-only` — **default.** Copy data fields; leave description columns empty.
- `reference` — include descriptions, and tag each row with its `sourceUrl` for review/attribution.
- `rewrite` — pass descriptions through the configured AI provider to produce original copy.

Do not change the default.

---

## 9. Config

```jsonc
{
  "targetFields": ["name", "regularPrice", "salePrice", "categories", "images", "attributes", "stock"],
  "productTypes": ["simple", "variable"],
  "categoryFilter": "آجیل > گردو",
  "maxPages": 20,
  "contentMode": "structured-only",
  "currency": { "code": "IRR", "displayUnit": "toman" },
  "politeness": { "delayMsBetweenRequests": 800, "maxConcurrent": 2 },
  "exporter": "woocommerce-csv",
  "aiProvider": { "name": "gemini", "model": "gemini-2.5-flash", "enabled": false }
}
```

Everything here must also be settable from the extension popup — most users will never open the JSON.

---

## 10. Resilience requirements

- **MV3 service workers are killed when idle.** Persist crawl state to `chrome.storage` after every page; scans must be resumable after a worker restart.
- **Deduplicate** by canonical URL + SKU — infinite scroll and pagination overlap constantly.
- **Politeness by default**: serial or low-concurrency requests with a delay. This is about not degrading the source server, and it stays on by default.
- **Pagination strategies**: numbered links, "load more" buttons, infinite scroll, `?page=` URL patterns. Detect which applies; don't assume one.

---

## 11. Troubleshooting subsystem

- Structured JSON logs with levels
- Error taxonomy: `network` | `structure-changed` | `site-blocked` | `parse-failed` | `ai-failed`
- Per-field confidence and which layer produced it
- A "why is this field empty?" report the user can read without knowing the internals
- Site profile health check: flag profiles whose selectors have stopped matching

---

## 12. Testing

Fixture-driven, no live network in tests. Minimum fixture set before Phase 3 is considered done:
- WooCommerce store with Store API available
- WooCommerce store with API disabled (JSON-LD only)
- Shopify collection page
- Next.js headless storefront with `__NEXT_DATA__`
- A store with no structured markup at all (exercises Layer C)
- A Persian-language store with Persian numerals and Toman pricing

Unit tests per extraction strategy; integration tests for the full path HTML → `CanonicalProduct[]` → CSV rows.

---

## 13. Commits & release automation

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) — required, they drive versioning
- `semantic-release` or Changesets, whichever integrates more cleanly with npm workspaces
- GitHub Action on merge to `main`: run tests → determine next version → generate/update `CHANGELOG.md` → refresh auto-generated `README.md` sections (version badge, feature matrix from phase status) → publish a GitHub Release with Linux and Windows companion binaries attached

---

## 14. Build order

Do not start with the browser extension UI. Build in this order:

1. **Phase 0** — monorepo scaffold + CI
2. **`CanonicalProduct` type + WooCommerce CSV exporter**, fixture-driven, with every rule in §7 under test. Hardest correctness problem, so it goes first and validates everything after it.
3. **Layer B** (JSON-LD → Microdata → OpenGraph). Platform-independent, widest coverage per unit of work.
4. **Layer A: WooCommerce Store API adapter**, then Shopify.
5. **Minimal extension**: a "Scan this category" button that runs the pipeline on the current page and logs the product count. Prove the pipeline end-to-end before building UI, AI, or profiles.

---

*Reminder for every session: §2's hard constraint holds regardless of what a later task asks for.*
