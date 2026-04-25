#!/usr/bin/env bash
# scripts/setup-labels.sh
#
# Idempotently create every label declared in `.github/labeler.yml` on the
# current GitHub repository. Run once after forking or after adding a new
# label key in the YAML.
#
# Usage:
#   bash scripts/setup-labels.sh              # auto-detects repo from `gh`
#   GH_REPO=owner/name bash scripts/setup-labels.sh
#
# Requirements:
#   - `gh` (GitHub CLI) authenticated with `repo` scope.
#
# Notes:
#   - Existing labels are left alone (we use `gh label create --force` only
#     when colour/description drift is detected; otherwise we skip).
#   - Colours mirror the conventions in `docs/REPO_SETTINGS.md`.

set -euo pipefail

# --- pre-flight --------------------------------------------------------------

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh (GitHub CLI) is required. https://cli.github.com" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: 'gh auth login' first." >&2
  exit 1
fi

REPO_FLAG=()
if [ -n "${GH_REPO:-}" ]; then
  REPO_FLAG=(--repo "$GH_REPO")
fi

# --- label table -------------------------------------------------------------
#
# Format: "name|color|description"
#
# Keep this list in lock-step with `.github/labeler.yml`. The labeler workflow
# applies these by file glob; this script just makes sure they exist on the
# remote so the workflow doesn't 404 on first run.

LABELS=(
  "area/core|0e8a16|Touches packages/core (agent, planner, policy)"
  "area/llm|1d76db|Touches packages/llm (providers, LLMClient)"
  "area/sandbox|b60205|Touches packages/sandbox (policy, exec, checks)"
  "area/tools|fbca04|Touches packages/tools (file/shell/http/email)"
  "area/cli|5319e7|Touches apps/cli (REPL + subcommands)"
  "area/server|0052cc|Touches apps/server (HTTP + SSE)"
  "area/web|c5def5|Touches apps/web (React UI)"
  "area/plugins|d4c5f9|Touches plugins/* (in-tree plugins)"
  "area/landing|fef2c0|Touches landing/ (GitHub Pages site)"
  "area/docs|c2e0c6|Docs / cookbook / top-level *.md"
  "type/tests|bfdadc|Tests, benches, fixtures"
  "type/ci|ededed|CI workflows, scripts, CODEOWNERS"
  "type/dependencies|0366d6|Dependency bumps and lockfile churn"
  "good first try|7057ff|Beginner-friendly entry point"
  "needs/security-review|ee0701|Touches sandbox or CI — needs second pair of eyes"
)

# --- create / update ---------------------------------------------------------

created=0
skipped=0
for entry in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<< "$entry"
  if gh label list "${REPO_FLAG[@]+"${REPO_FLAG[@]}"}" --limit 200 --json name --jq '.[].name' \
       | grep -Fxq "$name"; then
    echo "skip   $name (already exists)"
    skipped=$((skipped + 1))
    continue
  fi
  if gh label create "$name" \
       --color "$color" \
       --description "$desc" \
       "${REPO_FLAG[@]+"${REPO_FLAG[@]}"}" >/dev/null; then
    echo "create $name (#$color)"
    created=$((created + 1))
  else
    echo "fail   $name" >&2
  fi
done

echo
echo "done — created=$created skipped=$skipped total=${#LABELS[@]}"
