# GitHub Repo Settings (reference)

Copy / paste into the GitHub "Settings" UI once, then forget it exists.

## Metadata

- **Description** (≤ 150 chars)
  > OpenHand — secure, LLM-agnostic AI agent in TypeScript. Sandboxed
  > shell, plug-in tools, works offline.

- **Website**: `https://ricardo-foundry.github.io/openhand/`
- **Topics / tags**:
  `ai-agent`, `llm`, `typescript`, `sandbox`, `openai`, `anthropic`,
  `ollama`, `agent-framework`, `cli`, `plugins`, `sse`, `monorepo`,
  `automation`, `open-source`

## General → Features

| Feature      | Recommended |
| ------------ | ----------- |
| Wikis        | off (docs live in `/docs`) |
| Issues       | on          |
| Discussions  | on (Q&A + show-and-tell categories) |
| Projects     | off until real planning happens |
| Sponsorships | off         |
| Packages     | on          |

## Pull requests

- ☑ Allow squash merging (default)
- ☐ Allow merge commits (noisy history)
- ☑ Allow rebase merging
- ☑ Always suggest updating PR branches
- ☑ Automatically delete head branches

## Branches → main

- ☑ Require a pull request before merging
  - ☑ Require approvals (1)
  - ☑ Dismiss stale approvals when new commits are pushed
- ☑ Require status checks to pass before merging
  - Required: `typecheck`, `unit tests`, `e2e tests`, `bench`, `audit`
  - ☑ Require branches to be up to date before merging
- ☑ Require signed commits (nice to have, not blocking)
- ☑ Do NOT allow force pushes
- ☑ Do NOT allow deletions

## Pages

- Source: GitHub Actions (`.github/workflows/deploy-pages.yml`)
- Custom domain: none (use `github.io` subdomain until we have one)
- Enforce HTTPS: on

## Code security and analysis

- ☑ Dependency graph
- ☑ Dependabot alerts
- ☑ Dependabot security updates
- ☑ Dependabot version updates (`.github/dependabot.yml`)
- ☑ Secret scanning
  - ☑ Push protection
- ☑ Code scanning (CodeQL default config)

## Actions → General

- Workflow permissions: read (explicit opt-in per-workflow for write)
- Artifact and log retention: 30 days
- Fork pull request workflows from outside collaborators: require approval

## Labels (minimum set)

| Label              | Color     | Description                         |
| ------------------ | --------- | ----------------------------------- |
| `good first issue` | `#7057ff` | Beginner-friendly                   |
| `help wanted`      | `#008672` | Extra attention welcome             |
| `bug`              | `#d73a4a` | Something is broken                 |
| `enhancement`      | `#a2eeef` | New feature request                 |
| `security`         | `#b60205` | Security-relevant                   |
| `docs`             | `#0075ca` | Documentation-only change           |
| `needs-triage`     | `#fbca04` | Awaiting first response             |
| `discussion`       | `#cfd3d7` | Open question, no action yet        |

## Default issue labels

Move `needs-triage` to every new issue by default via a scheduled workflow
or the `actions/labeler` step. This keeps triage predictable.

## CODEOWNERS

`.github/CODEOWNERS`:

```
# Catch-all reviewer (repo owner).
*                       @Ricardo-M-L
packages/sandbox/       @Ricardo-M-L
packages/core/          @Ricardo-M-L
docs/                   @Ricardo-M-L
```

## Secrets (Actions → Repository secrets)

Only populate when needed; never commit these.

- `OPENAI_API_KEY` (optional — smoke test against real OpenAI)
- `ANTHROPIC_API_KEY` (optional — same)
- `NPM_TOKEN` (only when we start publishing `@openhand/*`)

## Releases

- Draft from tags matching `v[0-9]+.[0-9]+.[0-9]+`.
- Body template: pull the matching section from `CHANGELOG.md`.
- Generated from `docs/RELEASE_vX.Y.md` when one exists.
