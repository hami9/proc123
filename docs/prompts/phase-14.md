# Phase 14 · Inspector in the extension

**Package:** `packages/extension`
**Depends on:** phase 13 merged
**Roadmap:** [`../roadmap.md`](../roadmap.md) — phase 14
**Design:** `CLAUDE.md` §16, §18

## Goal

The popup gains three read-only views — technologies, fonts, images — over the
page the user has open, and the images view can download a selection. This is
the first time phase 13's engine faces real pages, and it ships to users on the
surface that already works, months before the app exists.

## Context you need

**The popup is `packages/extension/src/popup.ts` and `popup.html`**, 360px
wide, and already carries five buttons and a settings pane. Three more views
will not fit as more buttons — this phase needs a real information structure,
and §18's note that the popup is "360px of necessity" is the constraint to
design within, not to fight.

**Reading the page is `scripting.executeScript`**, wrapped in
`src/browser.ts`, injected from the service worker. `activeTab` covers it.
Phase 13's engine takes a document — the injected function is what turns the
live page into one.

**Computed styles are available here and were not in phase 13.** Fonts that
could only be known from `getComputedStyle` are this phase's job to supply into
the engine's optional input. Read phase 13's hand-off note for exactly which.

**Downloads go through the service worker, never the popup**, and the popup can
close mid-download. `background.ts` already owns the export path; images follow
it rather than inventing a second one.

## Do

- Three views over phase 13's engine, in a structure that survives 360px.
- Supply computed-style font data that phase 13 marked as needing a DOM.
- Image download of a user-selected subset, through the service worker.
- Keep every view read-only. §16: the inspector never modifies the page.

## Do not

- Do not re-implement any detection in the extension. If something is missing,
  it belongs in `core` — a rule that lives in the popup cannot be used by the
  app in phase 15 and will be written twice.
- Do not add host permissions. `activeTab` covers the open page; image
  downloads of a _different_ origin go through the existing optional-permission
  flow in `popup.ts`, with the same decline-is-an-answer behaviour.
- Do not start `packages/app`.

## Done when

- [ ] All three views work against at least two real shops, one of them
      client-rendered.
- [ ] Downloading a selection of images writes them, with the popup closed
      partway through, and the download completes.
- [ ] The popup is not cramped: the existing scan flow is no harder to reach
      than it is today.
- [ ] `npm run check` passes.
- [ ] `scripts/release/phases.json` says `done` for phase 14.
- [ ] Merged to `main` as `feat(extension): ...`.

## Hand off

Write into [`phase-15.md`](phase-15.md): which parts of the inspector proved
awkward at 360px, since the app has room and should not inherit a layout shaped
by a constraint it does not have.
