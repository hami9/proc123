# Phase 15 · App shell — Windows and Linux

**Package:** `packages/app` (new)
**Depends on:** phase 14 merged
**Roadmap:** [`../roadmap.md`](../roadmap.md) — phase 15
**Design:** `CLAUDE.md` §15, §18

## Goal

A Tauri v2 application that builds and runs on Windows and Linux, renders the
UI of §18, and displays a real scan result handed to it from a fixture. No live
network yet — that is phase 16. This phase is about the shell, the design
system, and getting Rust into the repository and into CI without disturbing
anything already there.

## Context you need

**This is the first Rust in the project.** Everything before it is TypeScript
under npm workspaces, and `npm run check` is the gate. Rust has to join that
gate rather than sit beside it, and the release workflow has to learn to build
it. Settling this is half of what this phase is for — the UI is the visible
half, the build is the half that will otherwise hurt every phase after.

**Keep Rust thin.** §15: HTTP, filesystem, the bridge server, the WebView host.
Business logic is TypeScript in `core`, shared with the extension. A rule that
ends up in Rust cannot be shared and will be written twice.

**The design system is decided in §18, not invented here** — the popup's warm
palette (`--accent: #7a3e1d`), dark and light following the OS, Persian and
English with real RTL. Read phase 14's hand-off note for what was awkward at
360px; the app has room and should not inherit those compromises.

**Tauri v2 is on the 2.11 line and is stable for desktop.** Android is phase
18, but the choices made here decide whether that phase is easy or a rewrite —
prefer what works on both over what is convenient on desktop alone.

## Do

- Scaffold `packages/app` as a Tauri v2 app inside the existing workspace.
- Wire Rust into CI so a Rust failure fails `npm run check` — or state plainly
  in the PR why it must be a separate job, if that turns out to be the honest
  answer.
- Build the §18 UI: routing, dark/light, Persian/English with RTL, layouts that
  will survive a phone screen in phase 18.
- Render a `CanonicalProduct[]` from a fixture, including the currency line —
  §7.8's toman/rial confirmation is part of the shell, not a later addition.
- Document the build in `packages/app/README.md`: toolchain, how to run it, how
  to build each target.

## Do not

- Do not fetch anything. Phase 16.
- Do not build the bridge. Phase 17.
- Do not target macOS or iOS. §15 gives the reasoning, and a half-built target
  is worse than an absent one.
- Do not fork any logic out of `core` into Rust because it is easier there.

## Done when

- [ ] `packages/app` builds and runs on Windows and on Linux.
- [ ] The UI renders a fixture scan, in both themes and both languages, with
      RTL correct in Persian.
- [ ] The currency confirmation is present and unmissable.
- [ ] CI builds the Rust side, and a deliberate Rust error fails the run.
- [ ] `npm run check` passes for the TypeScript workspaces as before.
- [ ] `scripts/release/phases.json` says `done` for phase 15.
- [ ] Merged to `main` as `feat(app): ...`.

## Hand off

Write into `phase-16.md`: how HTTP is exposed from Rust to the front end, and
whether the release workflow can cross-compile the targets or needs a build
matrix — phase 20 depends on that answer and should not have to rediscover it.
