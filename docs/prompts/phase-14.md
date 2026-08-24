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

## What phase 13 handed you

Phase 13 is merged. Everything below is exported from `@proc123/core`.

```ts
// One call, all three views. Pass `$` if you already parsed the document.
inspectPage(page: PageContext, options?: InspectPageOptions): PageInspection
// { url, technologies: Technology[], fonts: FontFamily[], images: ImageAsset[] }

// Or one at a time, when a view is opened lazily.
detectTechnologies(page: PageContext, $: CheerioAPI): Technology[]
groupTechnologies(technologies): Map<TechnologyCategory, Technology[]>  // one section per category
inspectFonts(page: PageContext, $: CheerioAPI, options?: InspectFontsOptions): FontFamily[]
inspectImages(page: PageContext, $: CheerioAPI): ImageAsset[]
```

Types: `PageInspection`, `Technology`, `TechnologyCategory`, `FontFamily`,
`FontOrigin`, `ImageAsset`, `ImageOriginKind`, `ComputedFontUsage`,
`InspectFontsOptions`, `InspectPageOptions`.

Three things to know before designing the views:

**`groupTechnologies` omits empty categories.** A real shop fires four or five
of the ten, so a UI with ten fixed headings is nine-tenths empty. Render the map.

**`ImageAsset.origins` is why the images view can be usable at 360px.** `icon`
and `meta` are kept separate from `img` precisely so the favicon and the Open
Graph preview are not offered alongside the product photographs in a
select-all. Filter on it rather than showing one flat list. `width`/`height` are
present only where the markup stated them, and `ImageAsset` has no byte size at
all — both are facts about the file, and phase 13 never fetches. If the view
wants them, that is a request the popup makes, on the popup's own budget.

**Empty is a real answer, not a failure.** A hand-written page genuinely returns
`technologies: []`. Design the empty state as an answer — "no recognised
technology" — rather than a spinner that never resolves or an error.

### What the font inventory could not determine — your job

`core` parses a string; it has no DOM and must not acquire one, so three things
are missing and the extension is the first surface that can supply them. All
three go in through `InspectFontsOptions.computed`, as `ComputedFontUsage[]`:

1. **Which elements actually use a family.** `FontFamily.usedBy` is only ever
   filled from `computed`. **Absent means "not measured", never "unused"** — do
   not render an unmeasured font as an unused one.
2. **Which family in a stack won.** `font-family: Vazirmatn, Tahoma, sans-serif`
   declares three; only `getComputedStyle` knows which one resolved. Pass the
   first entry of the resolved stack as `ComputedFontUsage.family`.
3. **Families declared in an external stylesheet on the site's own domain.**
   Phase 13 records a `<link>` to `/theme/style.css` as an origin but invents no
   families from it, because reading them means fetching it. A computed family
   the markup never declared is added rather than dropped — that case is exactly
   what this input is for.

What phase 13 _does_ get without help, so do not re-measure it: `@font-face`
families, weights and styles from inline `<style>`; Google Fonts and Adobe Fonts
families and weights read out of the stylesheet query string; `font-family` in
inline `style` attributes; and a family guessed from a preloaded font filename.

> One finding worth carrying: `parseSrcset` is not a comma split. A resizing
> CDN writes `/c_fill,w_300,h_300/pic.jpg`, and splitting on commas turns one
> product image into two broken URLs. If the extension ever parses a `srcset`
> itself, call `parseSrcset` rather than writing a second one.

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
the engine's optional input — the three of them are listed above.

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
