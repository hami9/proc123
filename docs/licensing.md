# Licensing and support

**Everything in this repository is MIT, and stays MIT.** There is no paid tier,
no commercial package, and no plan for one. If proc123 is useful to you, you owe
nothing; if you would like to support it anyway, see [Support](#support).

---

## The decision

| Package              | Licence |
| -------------------- | ------- |
| `packages/core`      | MIT     |
| `packages/exporters` | MIT     |
| `packages/profiles`  | MIT     |
| `packages/extension` | MIT     |
| `packages/companion` | MIT     |
| `packages/app` (§15) | MIT     |

Including the desktop and mobile application, when it exists. The whole thing is
free, for any use, including commercial use, including forking it and shipping
your own.

## A two-tier model was considered and declined

Written down so nobody re-proposes it in six months without knowing it was
already weighed.

The structure would have been: keep `core`, `exporters`, `profiles`, the
extension and the CLI open, and sell `packages/app`. It is a real pattern and it
can work. It was declined for a simpler reason than any of the arguments below —
the author does not want to sell software. But the arguments hold anyway, and
they are why nobody should feel this is a missed opportunity:

- **It could not protect the valuable part.** `core` is what a competitor would
  want and it is MIT in every release already published. A licence change cannot
  reach code that has already been given away.
- **It would have cost the project's central claim.** The extension's argument is
  that it reads pages honestly and sends nothing anywhere; `SECURITY.md` and
  [`privacy-policy.md`](privacy-policy.md) both invite the reader to check that
  against unminified source. Closing any of it retracts an argument already made
  in public.
- **It would have made contribution a legal problem.** A contributor owns their
  patch, so a commercial package needs a CLA before the first outside pull
  request or it becomes unsellable. That is real friction on a project that
  would rather have the patch.

## What this means in practice

- **Contributions are welcome everywhere.** No CLA, no carve-outs, no package
  that is off limits. [`CONTRIBUTING.md`](../CONTRIBUTING.md) is the whole of it.
- **No licence keys, no activation, nothing to verify.** Which also means §15's
  promise stays intact for free: there is no reason for the app to ever make a
  request that is not to the shop being scanned.
- **Forks are fine.** Someone may take this and sell it. That is what MIT means,
  it was known when the licence was chosen, and it is not a problem to be
  solved later.

## Support

Entirely optional, and the project does not behave differently either way. There
is no "supporter" build, no feature held back, no nag screen, and there never
will be — a donation link that changes what the software does is a paywall with
extra steps.

- **Sponsor:** [kgkala.ir](https://kgkala.ir)
- **Contact:** Telegram [@ham1235i](https://t.me/ham1235i) — for questions and
  other projects. Bugs still belong in issues, where the next person with the
  same shop can find them.

Both are in [`.github/FUNDING.yml`](../.github/FUNDING.yml), which is what puts
the **Sponsor** button on the repository.

Two practical notes for whoever changes them:

- **Use `custom:`, not a named platform.** GitHub Sponsors, Ko-fi, Liberapay,
  Open Collective and the rest are unavailable to accounts in sanctioned
  countries, and a button leading somewhere nobody can pay is worse than no
  button. `custom` takes any URL and works from anywhere.
- **AMO's "Contributions URL" will not accept these.** That field takes only a
  fixed list of donation hosts, so an arbitrary URL is rejected. Leave it empty
  on the add-on listing; the Telegram link belongs in AMO's **Support site**
  field instead, which has no such restriction.

## If money is ever the point

The way this tool makes money is not by being sold. It is by **doing the
migrations**: a shop owner moving a catalogue wants the job finished, not
software, and this is the reason that job takes hours rather than days. The tool
is the advantage, not the product — which is another reason giving it away costs
nothing.

That path has an obligation the free tool does not. §8's content modes stop
being a technical setting once someone is paying: copying a shop's descriptions
and photographs into another shop is exactly the exposure that section
describes, and doing it for a client makes it the operator's liability rather
than a hobbyist's. Keep `structured-only` as the default and get the customer's
decision about descriptions in writing.
