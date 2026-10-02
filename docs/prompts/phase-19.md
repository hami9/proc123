# Phase 19 · A visual picker for any field

**Package:** `packages/core` + `packages/extension` (+ `packages/app`)
**Depends on:** phase 6 (Layer C), phase 16 (rendering), phase 17 (the bridge)
**Roadmap:** [`../roadmap.md`](../roadmap.md) — phase 19
**Design:** `CLAUDE.md` §4 (Layer C), §5, §19

## Goal

Generalise Layer C from title/price/image to **any value the user points at**,
so the tool reads a spec table, a listing site or a directory — not only a
product grid. Profiles stay human-readable, exportable JSON.

**Done when** a user teaches a non-product page and the export carries the
fields they picked, with the profile still readable and hand-editable.

## What phases 16 and 17 left you

### Rendering alone does not extract — this is the finding that shapes the phase

Phase 16 built the WebView fallback and proved the thing it was built to prove,
and also the thing it was not: a client-rendered shop now _renders_, and a
rendered page with no structured markup and no profile still yields **nothing**.
Rendering gets a DOM; it does not get meaning. Layer C is what turns a DOM into
fields, and until phase 19 it can only learn three of them.

So the combination these shops actually need is **Layer C over the rendered
DOM**, and both halves now exist separately. Phase 19 is where they meet.

### Where a rendered DOM can be got, and what each one costs

| Source                          | Logged in?                       | Costs                                 | Where                               |
| ------------------------------- | -------------------------------- | ------------------------------------- | ----------------------------------- |
| The extension's `readPage`      | **Yes** — the user's own session | nothing, the tab is already open      | `extension/src/background.ts`       |
| A page handed over the bridge   | **Yes** — it came from that tab  | a pairing code                        | `app/src/scan.ts`, `scanHandedPage` |
| The app's WebView (`render.rs`) | **No** — starts with no cookies  | a second page load, every subresource | `app/src-tauri/src/render.rs`       |

The picker should be taught on the first of those. It is the only one where the
user is looking at the page they are pointing at, which is the whole interaction.

### What the picker needs that the current one does not have

`picker.ts` injects a click-capture for `PICKER_STEPS` — a fixed list of three
fields. Generalising it means:

- **The field list stops being a constant.** The user names the field, so a
  profile carries pairs the code has never heard of. `SiteProfile` already
  stores selectors per field name; what is fixed is `ProfileField`, and §5's
  canonical model is what the named fields have to map _onto_ at export time.
  A field with no canonical home is an extra column, not an error.
- **One click is not enough for a table.** A spec table is label/value pairs,
  so the picker needs a two-click mode — point at the label, point at the value
  — and to generalise from that pair to the rest of the rows the same way it
  generalises a card selector to the rest of the grid.
- **The selector must survive the render.** A selector learned on the rendered
  DOM is only valid against a rendered DOM. A profile taught in the extension
  and replayed by the app's static fetch will match nothing, and the failure is
  silent — empty columns, no error. Record on the profile _which_ DOM it was
  taught against, and have the replay refuse rather than quietly return blanks.

### What the bridge gives this phase for free

A page the user is signed in to can now reach the app (§17), so a profile taught
in the browser can be replayed by the app on a long crawl the popup could never
survive. The handoff carries `{url, title, html}` and nothing else — if the
picker needs to send a profile across too, that is a new field on `Handoff` in
`bridge.rs` plus the mirror in `extension/src/bridge.ts`, and
`PROTOCOL_VERSION` goes up.

## Do

- Keep profiles **readable, hand-editable, exportable JSON**. It is the thing
  that makes Layer C a feature rather than a black box (§4).
- Make the taught-against-rendered-DOM fact explicit on the profile, and act on
  it at replay time.
- Keep the picker in the extension first. It is the surface where the user is
  already looking at the page.

## Do not

- Do not let an unknown field name break an export. §5's model is the canonical
  one; extra fields ride alongside it.
- Do not widen `Handoff` without bumping `PROTOCOL_VERSION` on both sides.
- Do not build the app's own picker in this phase. The app can replay a profile
  it was handed; teaching in the app is a separate decision, and the WebView
  there has no session, which is exactly the wrong place to teach from.

## Done when

- [ ] A user teaches a non-product page and the export carries the fields picked.
- [ ] A profile taught against a rendered DOM refuses, loudly, to be replayed
      against a static fetch.
- [ ] Profiles are still readable JSON a person can edit by hand.
- [ ] `npm run check` passes; the Rust CI job passes.
- [ ] `scripts/release/phases.json` says `done` for phase 19.

## Hand off

Whatever the picker learns about **which** shops need the rendered DOM is worth
writing down — it is the first real data on how common client-rendered
storefronts are, and phase 18's Android target has the same problem with less
memory to solve it in.
