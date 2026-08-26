# Phase 17 · The bridge — app ↔ extension

**Package:** `packages/app` + `packages/extension`
**Depends on:** phase 16 merged
**Roadmap:** [`../roadmap.md`](../roadmap.md) — phase 17
**Design:** `CLAUDE.md` §17, §2, §3

## Goal

The app listens on `127.0.0.1` with a per-run token. The extension's service
worker connects to it and lends what only a browser has — a page the user is
logged in to. **Both keep working with the other uninstalled.**

## What phase 16 left you

**The app fetches, renders and writes files.** `src/http.ts` fills `core`'s
`HttpClient` seam over Rust; `src/render.ts` renders a page in a real WebView;
`src/save.ts` writes to disk through a native dialog. `src/scan.ts` ties them
together and falls back to rendering when a static read finds nothing.

**`runScan` lives in `core` now** (`core/src/scan/run.ts`), shared by the app and
the extension. Anything the bridge grows must go through it rather than beside
it — `countCurrencyUnits` in particular is what makes §7.8's question askable,
and a second copy of that rule is how this project produces a ten-times price
error.

**The renderer is hard-won and the reasons are written down.** Read the "five
bugs" section of `packages/app/README.md` before touching `render.rs`. The one
that will bite again: **an unanswered `eval` means the page has not loaded yet,
not that it failed** — wry queues the script and drops the callback.

### What the extension actually has that the app does not

This is the whole point of the bridge, and phase 16 proved the boundary
concretely rather than theoretically:

- **A logged-in session.** The app's WebView starts with no cookies. A shop
  behind a login is invisible to it and ordinary to the extension.
- **A browser engine the site expects.** On Linux the app's WebView is
  WebKitGTK; on Windows it is WebView2. A site that works in the user's Chrome
  may behave differently in either. The extension is _in_ the browser the user
  already trusts.

### What the app has that the extension does not

- No CORS, real files, a process that outlives a popup, and a WebView it can
  drive without a tab.

## Do

- Bind to `127.0.0.1` only. A port reported to the user. A token generated per
  run and **never persisted**. All three are the security model and none is
  optional (§17).
- The **service worker** holds the connection. A content script on an HTTPS page
  cannot reach `http://127.0.0.1` at all — that is mixed-content blocking, not a
  bug to work around (§3).
- Make both surfaces degrade cleanly and _say so_: the extension without the app
  and the app without the extension must both remain fully usable.

## Do not

- Do not let the bridge become the only way to do anything (§19).
- Do not persist the token, widen the binding beyond loopback, or add an
  authentication scheme in place of the per-run token.
- Do not move pipeline logic into the bridge. It carries pages and files; `core`
  decides what they mean.

## Done when

- [ ] A scan started in the extension finishes in the app with the popup closed.
- [ ] The extension works with the app uninstalled, under test.
- [ ] The app works with the extension uninstalled, under test.
- [ ] The token is per-run, the binding is loopback, and both are asserted.
- [ ] `npm run check` passes; the Rust CI job passes.
- [ ] `scripts/release/phases.json` says `done` for phase 17.

## Hand off

Write into `phase-19.md` what the picker needs from a rendered page — phase 16
proved that rendering alone does not extract, and Layer C over the _rendered_
DOM is the combination these shops actually need.
