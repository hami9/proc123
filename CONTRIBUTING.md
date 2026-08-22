# Contributing

Thanks for looking. The most valuable contribution to this project is not code —
it is **a shop it got wrong**. If a scan came back empty, short, or with a field
that is plainly incorrect, open an issue with the URL. That is the whole point
of the troubleshooting subsystem.

## Reporting a bad scan

1. Run the scan again and press **Why is this field empty?** in the popup (or
   pass `--report why.txt --log scan.jsonl` to the companion).
2. Open a [bug report](https://github.com/hami9/proc123/issues/new/choose) and
   attach both files. They carry no API keys and no page content, so they are
   safe to post publicly.
3. Include the category URL. Without it nobody can reproduce anything.

## Setting up

```bash
git clone https://github.com/hami9/proc123.git
cd proc123
npm install
npm run check     # format check, lint, typecheck, test — CI runs exactly this
```

Node 20.11+. On Windows, see
[docs/install-windows.md](docs/install-windows.md#c-building-from-source-optional).

`core`, `exporters` and `profiles` are consumed straight from TypeScript source.
The extension and the companion bundle at build time, because neither a browser
nor a single-file executable can run TypeScript.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), and they are
required rather than encouraged: semantic-release reads them to decide the next
version number, so a `fix:` that was written as `chore:` never ships.

```
feat(exporters): add the Shopify CSV exporter
fix(core): keep a regular and a sale price from different sources apart
docs: explain the toman/rial rule
chore(deps): bump vitest
```

`feat:` bumps the minor, `fix:` the patch, `BREAKING CHANGE:` in the body the
major. `docs:`, `chore:`, `refactor:`, `test:` and `style:` release nothing.

Nobody edits a version by hand. Four files state one and
`scripts/release/sync-version.mjs` owns all four — CI fails a pull request where
they have drifted. Same for the README's version badge and phase table, which
are generated from `scripts/release/phases.json`:

```bash
npm run release:check     # are the generated sections in step?
npm run release:dry-run   # what would the next release be?
```

## Pull requests

- One change per pull request.
- New behaviour comes with tests. There are ~760 of them and they are the reason
  anything here can be trusted with someone's product catalogue.
- Run `npm run check` before pushing.
- Explain _why_ in the description. The _what_ is in the diff.

Everything in this repository today is MIT and contributions to it are welcome
on those terms. `packages/app`, when it exists, will be the one exception —
see [`docs/licensing.md`](docs/licensing.md). It is not open for contributions
without a signed agreement, because a contributor keeps the copyright in their
own patch and a single unagreed one would make that package impossible to
license. This is stated here in advance so nobody writes something that then
cannot be merged.

## Things that will not be merged

This is not a scraping-evasion tool and will not become one. Anything that
solves or bypasses CAPTCHAs, spoofs fingerprints, applies "stealth" patches,
rotates proxies or IPs, or retries past an active block is out of scope
permanently — see [what proc123 will not do](README.md#what-proc123-will-not-do).
When a site says no, proc123 stops and says so.

Two more standing rules, because both have cost real money elsewhere:

- **A currency unit is never inferred.** `IRR` in markup tells us the currency
  and nothing about whether the number is toman or rial. Anything that guesses
  is a silent 10× price error.
- **A field is left empty rather than invented.** Including by the AI layer,
  whose output is checked back against the page it was given and discarded when
  the page does not support it.

## A note on code comments

Comments across the codebase cite `CLAUDE.md §N`. That is the original private
design brief; it is not published. Nothing is lost — every rule it states is
enforced by a test, and the tests are the authority.
