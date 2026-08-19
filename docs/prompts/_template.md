# Phase NN · <title>

**Package(s):** `packages/...`
**Depends on:** phase NN-1 being merged
**Roadmap:** [`../roadmap.md`](../roadmap.md) — phase NN
**Design:** `CLAUDE.md` §N

## Goal

One paragraph. What exists at the end that does not exist now, stated so that
someone can tell whether it is true.

## Context you need

What is already in the repository that this builds on, and where it is. Name
the files. This is the section that saves a session from re-deriving the
architecture — spend the words here.

Anything an earlier phase learned that changes how this one should be done.

## Do

- Concrete, checkable items.
- Name files where the location is a decision rather than an obvious one.

## Do not

- The adjacent work that is a different phase.
- The tempting widening — the thing that looks like it belongs but does not.
- Anything in `CLAUDE.md` §2's hard constraint. Always.

## Done when

- [ ] Testable statements, not activities. "A fixture page yields X", not
      "detection is implemented".
- [ ] `npm run check` passes.
- [ ] `scripts/release/phases.json` says `done` for this phase.
- [ ] Merged to `main` with a Conventional Commit that names the phase.

## Hand off

What the next phase needs to know that it could not have known before this one
ran. Write it into the next phase's file rather than leaving it here.
