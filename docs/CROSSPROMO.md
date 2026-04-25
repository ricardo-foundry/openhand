# Cross-promotion — sister projects

OpenHand ships next to two other small, opinionated, zero-noise projects
out of the same shop. They share a posture: zero runtime deps where it's
honest, MIT licence, runnable in 30 seconds, README that doesn't lie.
Each repo links the other two in its footer; the canonical block lives
here so any drift is one diff.

## The set

| Project | What it is | Repo | Highlights |
| --- | --- | --- | --- |
| **OpenHand** | LLM-agnostic agent runtime, sandboxed by default. | [ricardo-foundry/openhand](https://github.com/ricardo-foundry/openhand) | 4 providers, 8 plugins, 7-recipe cookbook, 383+ tests, 0 vulns, monorepo. |
| **Terminal Quest CLI** | Multilingual terminal RPG you launch with one `npx`. | [ricardo-foundry/terminal-quest-cli](https://github.com/ricardo-foundry/terminal-quest-cli) | Pure-Node REPL, season-locked quests, optional TTS, in-game tutorial. |
| **Canvas Vampire Survivors** | Vanilla-JS HTML5 Canvas roguelite, zero deps. | [ricardo-foundry/canvas-vampire-survivors](https://github.com/ricardo-foundry/canvas-vampire-survivors) | Live demo on Pages, no bundler, no framework, MIT. |

## Why these three together

- **Shared posture.** All three boast about *what they're not* (no
  vendor SDK, no bundler, no signup) before they boast about features.
- **Different surfaces.** A runtime, a TUI, a Canvas game. A reader who
  loves one will frequently like the others — they're all "small thing
  that fits in your head, runs offline, ships in one command".
- **Same author, same week.** Cross-linking is honest: the audience
  overlap is real and the maintenance is one keychain.

## Canonical footer block — paste verbatim

> ## Sister projects
>
> OpenHand ships alongside two other small, MIT-licensed projects from
> the same shop. If the "small things that fit in your head" posture
> resonates, you'll probably like these too:
>
> - **[Terminal Quest CLI](https://github.com/ricardo-foundry/terminal-quest-cli)** — a multilingual terminal RPG. `npx terminal-quest-cli` and you're playing.
> - **[Canvas Vampire Survivors](https://github.com/ricardo-foundry/canvas-vampire-survivors)** — a zero-dependency HTML5 Canvas roguelite. [Live demo](https://ricardo-foundry.github.io/canvas-vampire-survivors/).

The OpenHand README footer is updated to include the block above. The
sibling repos carry the reciprocal block (linking back to OpenHand and
to each other). When any of the three repos rebrands or moves, update
this file first, then propagate the diff to the other two.

## Cadence

- **Launch day**: cross-promo lands in all three READMEs in the same
  PR window. Item #30 of `RELEASE_CHECKLIST.md` blocks on this.
- **Steady state**: footer is touched only when a project moves repo,
  changes its tag-line, or is retired. No "featured projects" rotation —
  these three are the set.
- **Retirement**: if a project is sunset, the footer entry stays for at
  least 90 days as a redirect note before being removed; users who
  bookmarked the README still need to land somewhere useful.

## Anti-pattern guardrails

- Don't add a fourth project just because we ship one. Cross-promo is
  signal; signal degrades when the list grows. New projects start in a
  separate "Other things from this shop" line, never in the canonical
  block.
- Don't reciprocate cross-promos from outside the foundry. People ask
  occasionally; the answer is "thanks, we keep the footer to our own
  set". One sentence, no escalation.
- Don't backlink with affiliate IDs, tracking params, or shortened
  URLs. All links are the canonical `https://github.com/ricardo-foundry/<repo>`
  form.
