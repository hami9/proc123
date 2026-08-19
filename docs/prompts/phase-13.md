# Phase 13 · Inspector engine

**Package:** `packages/core`
**Depends on:** nothing — this is the first phase of the new plan
**Roadmap:** [`../roadmap.md`](../roadmap.md) — phase 13
**Design:** `CLAUDE.md` §16

## Goal

`core` can answer three questions about a document it is handed: what built
this site, what fonts does it use, and what images does it reference. No UI, no
network, no new dependency on a browser. At the end of this phase the extension
(phase 14) and the app (phase 15+) have something real to display, and neither
has to implement any of it.

## Context you need

**The technology detector already exists and is good.** `packages/core/src/platform/detect.ts`
scores weighted signals, sums them into a `confidence`, and returns _every_
signal that fired so §11's report can explain the answer. `PlatformDetection`
in `platform/types.ts` is its shape. This phase **widens the ruleset and
generalises the output**; it does not rewrite the model. Read that file before
designing anything — the design question is mostly already answered there.

Today it knows seven storefront platforms (`PlatformId` in `platform/types.ts`).
An inspector needs categories beyond storefronts: framework, analytics, CDN,
tag manager, payments, chat, fonts-as-a-service. A storefront platform is one
category among several, so `PlatformId` stops being the right return type for
the general case — but Layer A dispatches on it and must keep working. Widen
alongside it rather than through it.

**HTML parsing is Cheerio**, via `packages/core/src/extract/html.js`. There is
no DOM in `core` and this phase must not introduce one — the same code has to
run in a service worker, in Node, and in Tauri's WebView. Computed styles are
therefore _not_ available here: this phase reads stylesheets and markup. Where
a font can only be known from computed style, that is a phase 14 concern and
the engine should accept it as an optional input rather than trying to compute
it.

**Tests are fixture-driven and never touch the network** (§12). Fixtures live
beside the existing ones under `packages/core/test/`.

## Do

- Widen technology detection past storefronts, in the categories above, keeping
  the weighted-signal model and the every-signal-recorded rule.
- Add a font inventory: families, weights and styles requested, and where each
  came from (`@font-face` src, a stylesheet link, a font service).
- Add an image inventory covering `<img>`, `srcset`, `<picture><source>`, CSS
  backgrounds and `<link rel=preload as=image>`. Resolve every URL against the
  document base. De-duplicate. Report natural dimensions and byte size **only
  where the markup states them** — do not fetch to find out.
- Record the licence and provenance of every detection rule not written here,
  in the file that holds the rules. `CLAUDE.md` §16 explains why this matters.
- Export it all from `core`'s public surface (`src/index.ts`).

## Do not

- Do not fetch anything. Every function takes a document it was given. An
  inspector that makes its own requests breaks §10's politeness accounting and
  cannot run in the popup.
- Do not build UI. That is phase 14.
- Do not import Wappalyzer's ruleset or any other set whose licence has not
  been read. §16.
- Do not change `PlatformId` or Layer A's dispatch in a way that breaks the
  existing adapters — 756 tests currently pass and must still.
- Do not touch `packages/app`. It does not exist yet.

## Done when

- [ ] A fixture page yields its technologies with confidence and the signals
      that fired, across at least three categories beyond storefront platforms.
- [ ] A fixture page yields its font families with weights and sources.
- [ ] A fixture page yields its complete de-duplicated image list with absolute
      URLs, including at least one `srcset` and one CSS background.
- [ ] An honest `unknown` is returned where signals are absent — with a test
      that asserts it, because a confident wrong answer is the failure mode
      that matters here.
- [ ] Every rule set carries its licence and provenance in-file.
- [ ] `npm run check` passes; existing 756 tests still pass.
- [ ] `scripts/release/phases.json` says `done` for phase 13.
- [ ] Merged to `main` as `feat(core): ...`.

## Hand off

Write into [`phase-14.md`](phase-14.md): the exported API names phase 14 will
call, and anything the font inventory could not determine without computed
styles — phase 14 has a real DOM and can supply it.
