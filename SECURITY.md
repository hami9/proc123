# Security

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/hami9/proc123/security/advisories/new),
or email <ghostmasterar@gmail.com>.

Include what you did, what happened, and what you expected. A proof of concept
helps. Expect an acknowledgement within a few days — this is a small project,
not a company with a rota.

## What is in scope

- Anything that causes an API key to leave the browser, be written to a file, or
  appear in a report or log.
- Anything that makes proc123 issue requests the user did not ask for, or to a
  host other than the one being scanned.
- Anything that lets a scanned page influence what proc123 does, rather than
  only what it reads — the pages this tool reads are hostile input by
  definition.
- A crafted CSV that executes on import (formula injection and friends).

## Not in scope

- A shop that blocks the scan. That is the site exercising a choice, and
  proc123 stopping is the intended behaviour.
- Bugs in a target store's own software.
- Missing store-signing on the extension zips and companion binaries. Known,
  documented, and the reason Windows shows a SmartScreen prompt.

## What proc123 does with your data

- **API keys** are stored in browser extension storage only. They are
  deliberately refused in `proc123.config.json` so that exporting or sharing
  settings cannot leak one, and they are never written to reports or logs.
- **Scanned pages** are never uploaded anywhere, with one opt-in exception: when
  you enable Layer D and paste your own key, a _trimmed fragment_ of a page —
  scripts, menus and footers stripped — is sent to the provider you chose, and
  only for products the markup could not describe.
- **Reports and logs** written by "Why is this field empty?" and `--report` /
  `--log` contain no API keys and no page content, so they are safe to attach to
  a public issue.
- **No telemetry.** Nothing phones home, in any package.
