# Phase 16 · The app scans on its own

**Package:** `packages/app`
**Depends on:** phase 15 merged
**Roadmap:** [`../roadmap.md`](../roadmap.md) — phase 16
**Design:** `CLAUDE.md` §15, §10

## Goal

The app fetches. `core` runs behind Rust's HTTP client with no CORS to work
around, an embedded WebView resolves client-rendered shops, and a scan ends with
a CSV written straight to disk — no browser involved at any point.

## What phase 15 left you

**The shell exists and renders a real `CanonicalProduct[]`.** `src/fixture.ts`
is a saved scan standing in for a live one; phase 16's job is to replace where
it comes from, not what the views do with it. `renderScan()` in `main.ts` reads
`state.products` and nothing else, so the seam is that one field.

**The currency step is already built and already blocking.** `src/currency.ts`
owns the rule — `canExport()` returns false while an unanswered §7.8 question
exists, and the export button reflects it. A live scan must keep going through
that function rather than around it. This is the one piece of this app where a
shortcut is a ten-times price error.

**Rust is thin on purpose and should stay that way.** `src-tauri/src/lib.rs` has
one command (`host_info`) and a `setup` hook with a comment marking where the
HTTP client is built once rather than per call. §15's line holds: HTTP, files,
the bridge, the WebView host. If a rule feels easier in Rust, that is the signal
it belongs in `core`, where the extension and the companion can use it too.

### How HTTP should reach the front end

Phase 15 did not build this, but it settled the shape it has to take, and the
reason is `core`'s own design rather than a Tauri preference.

`core` already accepts an injected `HttpClient` — that is how the extension
gives it `fetch` and how the companion gives it Node's. So the app does **not**
need a new abstraction: it needs one `HttpClient` implementation whose methods
call `invoke('http_fetch', …)` and hand the response back in the shape
`platform/http.ts` already defines. Everything above it — Layer A, the crawler,
politeness — then works unchanged, because it never knew what was underneath.

Two things that fall out of that and are easy to get wrong:

- **Politeness is not the transport's job and must not be reimplemented in
  Rust.** §10's delay and concurrency limits live in `core`'s paced client. A
  native shell removes the browser's rate limits, which makes §10 more important
  rather than less — a Rust-side fetch that bypasses the pacing would quietly
  hammer somebody's shop.
- **Blocking detection stays in `core` too** (`platform/blocking.ts`). Rust
  returns status and headers; `core` decides what a 403 means. §2's hard
  constraint is that a block stops the scan, and that decision has one home.

### The build matrix answer, which phase 20 depends on

**Build each target on its own runner. Do not cross-compile.**

Tauri links against the platform's own WebView — WebKitGTK on Linux, WebView2 on
Windows — so cross-compiling means cross-compiling those bindings and the
bundler that packages them. It is the most reliable way to lose a day to this
stack for no gain, given that GitHub Actions offers both runners for free.

Phase 15's CI job builds Linux only, because that is what phase 15 needed. Phase
20 should turn it into a matrix over `ubuntu-latest` and `windows-latest`, which
is a change to the `runs-on` line and nothing else — the npm scripts are already
platform-neutral.

One thing Windows needs that Linux does not: **an `.ico`**. `src-tauri/icons/`
has PNGs only, and the MSI bundle will not build without it. `npx tauri icon
<square png>` generates the whole set.

## Do

- Implement `HttpClient` over a Tauri command, and wire `core`'s existing scan
  path to it.
- Embed a WebView to render client-rendered shops — the failure the CLI has
  always had, where a JS-built shop reads as zero products.
- Write the CSV to disk through Rust, with a real save dialog.
- Keep §10's politeness on by default and visible in the UI (§18 asks for honest
  progress: which page, how many products, which layer answered).

## Do not

- Do not move any part of the pipeline into Rust because it is faster there.
- Do not build the bridge. Phase 17.
- Do not add a way to bypass §2's hard constraint. A native shell makes
  CAPTCHA solving, fingerprint spoofing and proxy rotation _easier_ to build and
  no more acceptable.

## Done when

- [ ] The app scans a static shop end to end and writes a CSV to disk.
- [ ] The app scans a JS-built shop through the embedded WebView.
- [ ] Politeness is applied and no request path bypasses `core`'s paced client.
- [ ] A blocked site stops the scan and says so.
- [ ] `npm run check` passes; the Rust CI job passes.
- [ ] `scripts/release/phases.json` says `done` for phase 16.

## Hand off

Write into `phase-17.md`: how the app exposes its loopback port and per-run
token, and what the extension needs from it.
