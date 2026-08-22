# Licensing

Written before `packages/app` exists, because that is the only time it can be.

This is a structure, not legal advice. The reasoning is stated so it can be
argued with, and so nobody later has to guess why a package carries the licence
it does.

---

## The decision

Two tiers, split on package boundaries:

| Package              | Licence        | Why                                                                          |
| -------------------- | -------------- | ---------------------------------------------------------------------------- |
| `packages/core`      | **MIT**        | The engine. Open, auditable, and the reason anyone trusts the rest.          |
| `packages/exporters` | **MIT**        | Same. A CSV that imports correctly is a fact people should be able to check. |
| `packages/profiles`  | **MIT**        | Site profiles are the users' own work; a licence must not hold them hostage. |
| `packages/extension` | **MIT**        | Free, in both stores, and the way most people meet the project.              |
| `packages/companion` | **MIT**        | The CLI is for people who script. They are not the ones who pay.             |
| **`packages/app`**   | **Commercial** | Windows, Linux and Android — §15. The only part sold.                        |

Everything published so far stays MIT. That is not a concession; it is the
point. The open half is what makes the paid half credible.

## Why not license everything commercially

Because it would not work, and it would cost more than it earned.

The extension's whole claim is that it reads pages honestly and sends nothing
anywhere. `SECURITY.md` and [`privacy-policy.md`](privacy-policy.md) both invite
the reader to check that against the source, and the shipped bundles are
deliberately unminified so they can. Closing the source retracts an argument the
project has already made in public.

It would also not protect anything. `core` is the part a competitor would want,
and it is already MIT in every published release. A licence change cannot reach
code that has already been given away.

## What a commercial licence can and cannot do here

**It cannot be retroactive.** Everything released up to and including the
current version is MIT to everyone who has it, permanently. Nobody can be made
to stop using, forking or selling it.

**It can cover new code.** The copyright belongs to the author, so the next file
written can carry any licence the author chooses. `packages/app` has not been
written yet, which is exactly why this document exists now rather than after
phase 15.

**It needs a CLA if anyone else contributes to the app.** A contributor owns
their patch. Without an agreement assigning or licensing it, their contribution
cannot be relicensed or sold — and one merged pull request is enough to make the
package unsellable. Either keep `packages/app` closed to outside contributions,
or add a CLA before the first one arrives. Doing neither is the mistake that is
expensive to undo.

## Selling without an account

§15 says no account, no server, no telemetry — a product principle, not a
default. A licence must not break it, and it does not have to.

**An offline signed key.** A purchase produces a key signed with the project's
private key. The app verifies the signature locally, with the public key baked
into the build. No request is made, at purchase time or ever after. The app
works on a machine that has never been online.

What this does not do is stop copying, and it is not meant to. A key can be
shared, and someone determined will share it. The purpose is to make paying the
obvious path for someone who wants the thing to keep working and keep being
updated — not to fight the customer. Anti-piracy machinery that phones home
would cost the principle in §15 and buy very little.

**Never**: a licence check that makes a network request, a trial that expires
against a server clock, or a build that refuses to run offline. Any of those and
the answer to "does anything leave my machine?" stops being _no_.

## Distribution, per surface

- **Extension** — free in both stores. It is the funnel, and it has to be good
  on its own terms rather than crippled to sell something else. No feature is
  removed from it to create a reason to buy the app.
- **CLI** — free with the releases, as now.
- **App** — sold directly, and through Microsoft Store where that is simpler.
  Google Play may refuse a general extraction tool at all
  ([`roadmap.md`](roadmap.md) phase 18), so the Android build plans for
  sideloading and treats Play as a bonus.

## What the app may charge for

Only things that cost something to provide, or that only the app can do:

- Running without a browser, on a schedule, over a large catalogue.
- Writing files directly, downloading and repackaging images.
- Rendering JS-built shops in its own WebView.
- Support, and site profiles built to order.

Not: the extraction engine, the exporters' correctness, or anything the
extension already does. Those are MIT and stay reachable free.

## The other way to make money, which needs no licence at all

Worth writing down because it is likely the larger number: **doing the
migrations**. A shop owner moving a catalogue wants the job finished, not
software. The tool is the reason that job takes hours rather than days — it is
the advantage, not the product.

That path has its own obligation. §8's content modes stop being a technical
setting once someone is paying: copying a shop's descriptions and photographs
into another shop is the exposure that section exists to describe, and doing it
for a client makes it the operator's liability rather than a hobbyist's. Keep
`structured-only` as the default and make the customer decide about
descriptions, in writing.

## Practical steps, in order

1. Keep every existing package MIT. Change nothing that is already published.
2. When `packages/app` is created, its `package.json` says
   `"license": "SEE LICENSE IN LICENSE-app.md"`, and that file is written in the
   same commit as the first line of app code.
3. Add the CLA, or state in `CONTRIBUTING.md` that `packages/app` takes no
   outside contributions — before phase 15 merges, not after.
4. Generate the signing keypair for licence keys offline. The private key never
   enters the repository, CI, or any machine that builds public artefacts.
