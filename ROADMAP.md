# proc123 — Project Roadmap

**Universal e-commerce catalog scanner → portable, import-ready CSV**

---

## 1. Goal

The user browses to a **category / collection page** on any online store, clicks one button, and proc123:

1. Discovers every product in that category (across pagination / infinite scroll)
2. Extracts key fields for both **simple** and **variable** products (including every variation)
3. Normalizes everything into a single platform-neutral data model
4. Exports a CSV that **imports cleanly into another store** — WooCommerce first, Shopify second

WooCommerce is the first *export* target and the first *source* adapter, but the architecture is platform-neutral from day one. Any store — Shopify, Magento, PrestaShop, OpenCart, headless/custom builds — must be supported through a common pipeline.

---

## 2. Core Architecture Decision

proc123 is a **browser extension (Manifest V3)** plus an optional **desktop companion app**, not a standalone headless scraper.

| | Browser extension (chosen) | Standalone headless scraper |
|---|---|---|
| Session / cookies / TLS | Real — it's the user's own browser | Synthetic, must be simulated |
| Cross-platform cost | Free wherever Chrome/Firefox runs | Separate build & test per OS |
| JS-heavy / SPA stores | Already rendered by the browser | Needs a full headless engine |
| Setup friction for user | Install extension, done | Runtime, drivers, dependencies |

The companion app handles what an extension can't: writing files to disk, calling AI provider APIs with a user key, heavy CSV assembly, and batch jobs.

**Consequence:** proc123 operates as a real user in a real browser session, so it does not encounter — and must never attempt to defeat — bot-detection systems. If a site actively blocks automated reading (CAPTCHA challenge, repeated 403, active rate limiting), proc123 stops and tells the user. This constraint is permanent and applies to every phase.

---

## 3. The Extraction Pipeline (platform-agnostic)

Four layers, tried in order. The first layer that returns complete Tier-1 data wins. This ordering is what makes "every store" realistic instead of aspirational.

### Layer A — Platform-native structured endpoints
Highest fidelity, zero HTML parsing. Detect the platform, then hit its public catalog endpoint.

| Platform | Detection signal | Public catalog source |
|---|---|---|
| WooCommerce | `wp-json` link header, `woocommerce-*` body classes | `GET /wp-json/wc/store/v1/products` — unauthenticated, `page` + `per_page`, `category` filter, `X-WP-TotalPages` header |
| Shopify | `Shopify.shop` global, `cdn.shopify.com` assets | `GET /collections/{handle}/products.json?limit=250&page=N` — **unofficial**, merchant can disable it, pagination is not guaranteed; always verify count and fall through if short |
| Magento 2 | `Magento_` JS modules, `/static/version` paths | `POST /graphql` catalog query (often open for read) |
| Next.js / Nuxt / headless | `__NEXT_DATA__`, `__NUXT__`, Apollo cache blob in DOM | Parse the embedded JSON state directly — usually contains the full product objects |
| PrestaShop / OpenCart / custom | Meta generator tags, path patterns | No native endpoint → fall through to Layer B |

### Layer B — Structured markup in the page (the true universal layer)
Works on the majority of stores regardless of platform, because SEO forces stores to publish it:
- **JSON-LD** `<script type="application/ld+json">` with `@type: Product`, `ItemList`, `BreadcrumbList`
- **Microdata** `itemtype="…schema.org/Product"`, `itemprop="price|name|image|sku"`
- **OpenGraph / product meta** `og:title`, `og:image`, `product:price:amount`
- **Merchant feeds** — probe for `sitemap.xml` (product URL discovery) and Google Merchant / RSS product feeds when present

### Layer C — DOM heuristics + **Selector Learning Mode**
When A and B fail, the user enters learning mode and clicks the title, the price, and the image on **one** product card. proc123 derives a stable selector for each, saves it as a reusable **site profile** (`profiles/{domain}.json`), and applies it to every card on every page.

This is the feature that actually delivers "works on all stores" — instead of hard-coding selectors for a fixed list of themes, the tool learns any site in ~15 seconds and remembers it. Profiles are plain JSON and can be shared or version-controlled.

### Layer D — AI fallback
Only fires when A–C leave Tier-1 fields incomplete. A trimmed DOM subtree (not the whole page) is sent to a pluggable AI provider with a strict JSON schema. Pay-per-token, so it must stay a last resort, not the default path.

---

## 4. Canonical Data Model → Multiple Exporters

Everything converges on one internal type, then fans out to format-specific exporters. This is what keeps the project from becoming WooCommerce-only.

```
Source site (any platform)
        ↓  Layer A / B / C / D
   CanonicalProduct[]        ← single normalized model
        ↓
   ┌────────────┬──────────────┬──────────┐
WooCommerce   Shopify       Generic     (future:
   CSV          CSV          JSON      Magento, etc.)
```

`CanonicalProduct` holds: identity, type (`simple` | `variable` | `variation`), title, descriptions, price set, currency, stock, images, category path, attributes, variations, source URL. Nothing platform-specific.

---

## 5. Phases

### Phase 0 — Scaffolding
npm workspaces monorepo, TypeScript strict, ESLint + Prettier, Vitest, baseline GitHub Actions (lint + test on PR).

Packages: `core` (pipeline + model), `extension`, `companion`, `exporters`, `profiles`.

### Phase 1 — Canonical model + WooCommerce CSV exporter
Build the exporter **first**, driven by fixtures. Getting import-compatibility right is the hardest correctness problem in the project (see §6), and building it first means every later phase is validated against a real target.

### Phase 2 — Layer B (structured markup)
JSON-LD → Microdata → OpenGraph. Platform-independent, so it delivers the widest coverage per unit of work. Ship this before any platform-specific adapter.

### Phase 3 — Layer A adapters
WooCommerce Store API first, then Shopify, then embedded-state parsing (`__NEXT_DATA__` / `__NUXT__`). Each adapter behind a common `PlatformAdapter` interface.

### Phase 4 — Category traversal
Numbered pagination, "load more" buttons, infinite scroll, and `?page=` URL patterns. Deduplicate by canonical URL + SKU. Persist crawl state so a scan survives an MV3 service-worker restart (see §6).

### Phase 5 — Variable products & variations
Detect variation selectors, enumerate attribute combinations, capture per-variation price / stock / SKU / image. Link each variation to its parent in the canonical model.

### Phase 6 — Layer C: Selector Learning Mode
Click-to-teach UI, selector derivation, site profile persistence, profile import/export.

### Phase 7 — Filtering & field selection
`proc123.config.json` + a popup UI: which field tiers, which product types, which category, max pages, request delay.

### Phase 8 — Layer D: pluggable AI providers
`AIProvider` interface with Gemini / OpenAI / Claude implementations. User supplies their own key. Structured-output mode enforced.

### Phase 9 — Troubleshooting subsystem
Structured JSON logs, error taxonomy (network / structure-changed / site-blocked / parse-failed), per-field extraction confidence, a "why is this field empty?" report, and site-profile health checks.

### Phase 10 — Cross-platform packaging
Extension: one MV3 build for Chrome/Edge/Brave, one for Firefox. Companion: single binaries for Linux and Windows (Node SEA or `pkg`). macOS next; Android via Firefox extensions; iOS via Safari Web Extensions later.

### Phase 11 — Release automation
Conventional Commits → `semantic-release` (or Changesets). On merge to `main`: test, version, generate `CHANGELOG.md`, refresh the auto-generated `README.md` sections (version badge, feature matrix derived from phase status), publish a GitHub Release with Linux/Windows binaries attached.

### Phase 12 — Additional exporters
Shopify product CSV, then generic JSON / Excel.

---

## 6. Known Traps (found while validating against current docs — do not rediscover these the hard way)

These were bugs in the first draft of this plan. Each has a required fix.

**1. You cannot force product IDs on import.** WooCommerce's importer always assigns the next available ID; the sample export's `id:4824` parent references only work inside the store that produced them. → **Link variations to parents by SKU, not ID.**

**2. Scraped products usually have no SKU, but every row needs a unique one.** → Generate deterministic SKUs (e.g. `P123-{hash(sourceUrl)}` for parents, `{parentSku}-{attrSlug}` for variations). Deterministic means re-scanning the same catalog produces the same SKUs, so re-imports update instead of duplicating.

**3. Localized CSV headers don't auto-map.** The sample export has Persian headers because it came from a Persian-locale store. A store with a different locale won't auto-map them. → **Emit canonical English headers** (`ID`, `Type`, `SKU`, `Name`, `Regular price`, `Categories`, `Images`, `Parent`, `Attribute 1 name`…). Offer localized headers only as an explicit opt-in.

**4. Row order matters.** Each parent row must appear immediately before its own variation rows.

**5. Parent rows of variable products must have empty price columns** — empty, not `0`. Prices live on the variation rows.

**6. Global vs. local attributes.** `Attribute N global = 1` requires that attribute taxonomy to already exist on the target store. For portable output, **default to `global = 0`** (local attributes) and make global an opt-in.

**7. Parent row lists all attribute values; each variation row lists exactly one** — and the strings must match character-for-character (`500 گرم` on the parent must be `500 گرم` on the variation, not `500g`).

**8. Number normalization is not optional.** Source pages show `۱٬۵۰۰٬۰۰۰ تومان`; the CSV needs `1500000`. Required: Persian/Arabic-Indic digit conversion, separator stripping, decimal point (never comma), and explicit **Toman ↔ Rial** handling with a user-visible unit toggle — a silent 10× error here is the single most damaging bug this tool could ship.

**9. Encoding.** UTF-8 with BOM so the file opens correctly in Excel. Document that Excel round-trips can corrupt the file; recommend LibreOffice or direct import.

**10. Theme/plugin meta columns are not extractable.** The `meta: woodmart_*`, `meta: rank_math_*`, and `meta: _elementor_*` columns in the sample exist only in the source store's database and are never rendered in another store's HTML. → Document this clearly; leave them empty rather than fabricating values.

**11. MV3 service workers are killed when idle.** A long scan will lose in-memory state. → Persist crawl progress to `chrome.storage` after every page and make scans resumable.

**12. Content scripts on HTTPS pages can't call `http://127.0.0.1`** (mixed content). → All companion traffic must be proxied through the background service worker, which is exempt.

**13. Image URLs may not survive import.** WooCommerce sideloads images from the URLs in the CSV; sites that block hotlinking or external fetches will produce products with no images. → Offer two modes: reference-by-URL (fast) or download-and-repackage via the companion app (reliable).

**14. Shopify's `/products.json` is unofficial.** It's capped, merchants can disable it, and pagination is unreliable. → Always cross-check the returned count against the category's displayed total and fall through to Layer B when they disagree.

---

## 7. Content Reuse — a practical note

The mechanical part of a catalog — SKUs, prices, weights, stock, attribute names, category structure — is data, and moving it between stores is exactly what this tool is for: platform migration, supplier and distributor catalog ingestion, and inventory sync are all normal work.

Long-form product descriptions and photographs are a different thing. They're authored content owned by whoever wrote and shot them, and republishing them verbatim is both a legal exposure and an SEO liability — duplicate content across stores tends to get one of them deprioritized in search results, and it usually isn't the original.

So proc123 should ship with a **Content Mode** setting:
- `structured-only` (default) — copy data fields; leave description columns empty for the user to write
- `reference` — include descriptions but tag each row with its source URL for attribution and review
- `rewrite` — pass descriptions through the configured AI provider to produce original copy in the user's brand voice

Default to `structured-only`. That default is the one that keeps users out of trouble and produces better-ranking stores.

---

## 8. Permanently Out of Scope

- CAPTCHA solving
- Browser-fingerprint spoofing / stealth patches
- Proxy or IP rotation intended to evade a site's blocking
- Continuing a scan after a site has actively signalled a block

If a target site blocks automated reading, proc123 stops and reports it. It does not work around it.
