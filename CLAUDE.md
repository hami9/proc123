# proc123 — Project Brief for Claude Code

> Loaded at the start of every session. Read it fully before writing code.
>
> **Section numbers are load-bearing.** Roughly forty comments and test names across `packages/` cite `CLAUDE.md §N` — §4, §7.2, §7.8, §8, §9, §10, §11 among them. Renumbering a section silently invalidates all of them. Add new sections at the end; never insert one in the middle.
>
> §1–§14 describe the extraction engine and the browser extension, and are unchanged from the brief the existing code was written against. §15 onward describe the desktop and mobile application, which is the work now in progress. [`docs/roadmap.md`](docs/roadmap.md) sequences it; [`docs/prompts/`](docs/prompts/) is what an individual session is handed.

---

## 1. What we're building

**proc123** lets a user browse to a category/collection page on **any** online store, click one button, and get a CSV that imports cleanly into **another** store.

It must handle simple products and variable products (with all variations), on WooCommerce, Shopify, Magento, headless/custom storefronts, and sites with no recognizable platform at all.

Primary export target: WooCommerce product CSV. Secondary: Shopify CSV, generic JSON.

---

## 2. Architecture

A **Manifest V3 browser extension**, a **command-line companion**, and — as of §15 — a **desktop and mobile application**. Three surfaces over one engine; none of them replaces another.

- The extension runs inside the user's own browser session on pages the user has already opened. Real cookies, real session, real rendering — SPA and JS-heavy stores work for free. **It stays.** It is the only surface that can read a page the user is logged in to, and nothing else can substitute for that.
- The companion (Node.js, `localhost` only) does what an extension cannot: write files to disk, call AI provider APIs, assemble large CSVs, download and repackage images.
- The application (§15) is the companion's successor as a *user-facing* surface, and covers Windows, Linux and Android from one codebase. The CLI remains for scripting.

Every one of them consumes `core` and `exporters` unchanged. A feature that lands in only one surface is a design failure unless there is a stated reason it cannot exist in the others.

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

§14 is history — phases 0–12 are done. New work is sequenced in [`docs/roadmap.md`](docs/roadmap.md).

---

## 15. The application — Windows, Linux, Android

**Tauri v2**, one codebase, three targets. Lives in `packages/app`.

Why Tauri and not two shells: it is the only option that produces all three targets the project needs from a single UI and a single set of business logic. Electron does not do Android; Capacitor does not do desktop well; a PWA cannot fetch an arbitrary origin, which is the entire job. The cost is Rust in the repository for the first time, and it is confined to a thin native layer — HTTP, filesystem, the bridge server, and the WebView host. Business logic stays in TypeScript, in `core`, shared with the other two surfaces.

What the app can do that the extension cannot:

- **Fetch any origin without CORS.** Requests go through Rust, so the browser's cross-origin rules do not apply at all.
- **Write files directly.** No download prompt per export, no popup that must stay open.
- **Render JS-built stores by itself**, in an embedded WebView — the failure the CLI has always had, where a client-rendered shop reads as zero products.
- **Run without a browser at all**, which is the whole point on Android.

What it cannot do, and must not pretend to: read a page the user is logged in to. That is the extension's, and only the extension's. When both are present, §17's bridge is how they cooperate.

### No account, ever

No login, no sign-up, no server owned by this project, no telemetry, no analytics, no crash reporting that leaves the device. A scan is between the user and the shop they are scanning. The only outbound requests the app makes are to the site being scanned, and — when the user has pasted their own key — to their own AI provider. This is a product principle, not a default to be revisited: if a feature needs an account, the feature is wrong.

### Platform reach

Windows and Linux are the desktop targets; macOS is not being built and should not be half-built. Android is the mobile target; iOS is out of scope because sideloading a scraper is not a route Apple leaves open, and building for a store that will reject it wastes the work.

---

## 16. The inspector

The app and the extension both expose a set of read-only tools that answer "what is this page made of?" They share one implementation in `core`, are fixture-driven, and make **no requests of their own** — every one of them reads a document that has already been fetched.

- **Technology detection** — what built this site. This is an expansion of the existing `platform/detect.ts`, not a rewrite: its weighted-signal model, its "keep every signal that fired" rule, and its `confidence` output are already right. Widen the ruleset beyond storefront platforms to frameworks, analytics, CDNs, tag managers, payment and chat widgets. Never claim a detection the signals do not support — an honest `unknown` beats a confident guess, and §11 has to be able to explain every answer.
- **Fonts** — every family actually used on the page, with the weights and styles requested, where each was loaded from, and which elements use it. Read from computed styles and from the stylesheets, not from a guess at the CSS.
- **Images** — every image the page references: `<img>`, `srcset`, `<picture><source>`, CSS backgrounds, and `<link rel=preload as=image>`. Report the natural dimensions and byte size where they are known, and let the user download a selection. Download is the app's job (§15) or the companion's, never the popup's.
- **Any value on the page** — §19's picker generalizes Layer C from "title, price, image" to any field the user points at, so the tool extracts a spec table or a listing site, not only a product grid.

The inspector never modifies the page it is looking at.

### Licensing care

Technology-detection rulesets are the tempting shortcut here and most of the well-known ones are not licensed for reuse — Wappalyzer's ruleset stopped being open source, and copying it in would put a licence violation into a repository that is otherwise clean MIT. Write the rules, or take them from a source whose licence has been read and recorded in the file that holds them.

---

## 17. The bridge — app ↔ extension

When both surfaces are installed on a desktop, each one holds something the other needs. The extension has the live, authenticated, fully-rendered page. The app has the disk, no CORS, and no five-minute service-worker death. The bridge lets them cooperate instead of duplicating.

- The **app** listens on `127.0.0.1` only, on a port it reports to the user, with a **token generated per run** and never persisted.
- The **extension's service worker** holds the connection. A content script must never talk to the bridge directly — a content script on an HTTPS page cannot reach `http://127.0.0.1` at all, which is mixed-content blocking, not a bug to work around (§3).
- The extension **offers**: the current tab's rendered DOM, its cookies-as-session for that origin only, and the user's click when a selector is being taught.
- The app **offers**: fetching, file writing, image downloading, AI calls, and long-running crawls that outlive the popup.
- **Both work alone.** Neither may hard-depend on the other being present. The bridge is an enhancement that makes both better; a build where the extension is useless without the app has broken this rule.

The token, the loopback binding, and the per-run lifetime are the whole of the security model, and none of the three is optional.

---

## 18. UI

The popup is 360px of necessity. The app is not, and should not be a stretched popup.

- **Dark and light**, following the OS, with the same brand palette the popup already uses (`--accent: #7a3e1d`, warm neutrals) so the three surfaces read as one product.
- **Persian and English**, with correct RTL. The project's users scan Persian shops; a layout that only works in LTR is half-built. Persian and Arabic-Indic numerals must render as the user expects while the *data* stays ASCII-normalised (§7.8).
- **The currency question is UI-critical.** §7.8's toman/rial confirmation is the single worst silent failure this project can produce. It gets a deliberate, unmissable step before any export, on every surface. Never a checkbox someone can skip past.
- **Long scans need honest progress** — which page, how many products, which layer answered, what was skipped and why. A spinner that says nothing for four minutes is a bug report waiting to happen.
- Touch targets and layout must survive a phone screen, because Android is a first-class target and not a port.

---

## 19. Licensing

**Everything in this repository is MIT, including `packages/app`, and stays that way.** [`docs/licensing.md`](docs/licensing.md) carries the reasoning and records that a paid tier was considered and declined, so it is not re-proposed as a fresh idea.

- Nothing is relicensed, no package is carved out, and no feature is held back from one surface to create a reason to buy another. There is nothing to buy.
- **Contributions are welcome in every package.** No CLA is needed, because nothing here has to be relicensable.
- **No licence keys, no activation, no trial.** This is not a constraint to work around — it is the reason §15's promise is free to keep: there is no mechanism that would ever need to make a request that is not to the shop being scanned.

Support is optional and changes nothing. There is no supporter build, no feature behind a link, and no nag — a donation prompt that alters behaviour is a paywall with extra steps. The link lives in `.github/FUNDING.yml`.

---

*Reminder for every session: §2's hard constraint holds regardless of what a later task asks for. It applies to the app exactly as it applies to the extension — a native shell removes the browser's restrictions, which makes the constraint more important, not less.*
