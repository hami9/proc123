# Session prompts

One file per phase. Each is written to be the **only** thing a session needs on
top of `CLAUDE.md` — so a fresh session can pick up a phase without reading the
whole repository first, and without a previous conversation to inherit.

That is the point. A long project run in one enormous conversation spends most
of its budget re-reading what it already decided; run as a series of scoped
sessions, each one starts cheap and ends with something merged.

## Running a phase

```
Read CLAUDE.md and docs/prompts/phase-13.md, then do the phase.
```

That is the whole invocation. The phase file carries its own goal, its own
boundaries, and its own definition of done.

## The rules that make it work

**One phase per session.** Not two, however small the second looks. The value
of a scoped session is entirely in the scope.

**Land it before moving on.** A phase ends on `main` and tagged — not on a
branch, not "ready to commit". `semantic-release` cuts the tag from the commit
messages, so the commit type is what decides the version.

> This is the maintainer's own workflow, and it is deliberately not what
> [`CONTRIBUTING.md`](../../CONTRIBUTING.md) asks of everyone else. An outside
> change still arrives as a pull request and still gets reviewed; a phase run
> by the person who owns the repository does not need a pull request to
> themselves.

**Update the status.** `scripts/release/phases.json` is the single source of
truth and the README table is rendered from it. A finished phase that still
says `next` will be started again by someone.

**Write down what you learned, not just what you built.** If a phase discovers
something the next one needs — an API that lies, a Rust crate that does not
cross-compile, a store policy — it goes in the next phase's file, or in
`CLAUDE.md` if it outlives the phase. This is the only channel between sessions
that survives; a finding left in a conversation is a finding lost.

**When a phase turns out to be wrong, say so and stop.** The plan was written
in advance and in ignorance of what the code will look like by then. Re-cutting
a phase is cheap; delivering the wrong one is not.

## Writing a new phase file

Copy [`_template.md`](_template.md). Keep it short: a phase file that runs to
several pages is really two phases, and the length is the tell.

Every one of them states what is **out** of scope as plainly as what is in.
Most of the ways a session goes wrong are a reasonable-looking widening of the
task — fixing an unrelated thing it noticed, or building phase N+1 because it
was right there.
