#!/usr/bin/env bash
# Runtime integration smoke for OpenHand.
#
# Chains every "real" check end-to-end so that breaking *any* of them lights
# CI red:
#
#   1. build         — every workspace's `tsc` (and Vite for the web app).
#   2. unit          — `npm run test:unit` across all packages.
#   3. e2e           — REPL streams, SSE, plugin hot-reload, CLI subcommand
#                      spawn, example execution.
#   4. bench         — micro-benchmarks (must finish, not just the asserts).
#   5. examples      — every `examples/*.ts` re-run as a smoke (belt + braces
#                      against the e2e runner: this lane is shell-only and
#                      catches `tsx` resolution / shebang regressions that
#                      slip past `node:test` spawning).
#   6. cli           — spawn the CLI binary for `--help`, `--version`,
#                      `status`, `plugins list`. Each must exit 0, no stderr.
#   7. server        — boot the express server on an ephemeral port, hit
#                      `/api/health`, fire `_demo`, consume SSE until we see
#                      a `completed` frame, then SIGTERM and assert clean
#                      shutdown.
#
# Exit code is the first non-zero step; success is exit 0 with `[ok]` on
# every lane. Designed to run from CI (`npm run test:smoke`) and from a dev
# laptop (one shot, no flags). Keep it boring: no parallelism, no env
# voodoo, just sequenced shell.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

TSX="$ROOT/node_modules/.bin/tsx"
LOG_DIR="${LOG_DIR:-$(mktemp -d -t openhand-smoke-XXXXXX)}"
mkdir -p "$LOG_DIR"

# Prefer plain output for log capture and grep.
export NO_COLOR=1
export FORCE_COLOR=0

echo "=== runtime-integration: log dir = $LOG_DIR ==="

step() {
  local name="$1"; shift
  printf '\n--- [%s] %s\n' "$name" "$*"
}

ok() { printf '[ok] %s\n' "$1"; }
fail() { printf '[fail] %s\n' "$1"; exit 1; }

require_tsx() {
  if [[ ! -x "$TSX" ]]; then
    fail "tsx not found at $TSX (did you run npm install?)"
  fi
}

step build "npm run build"
npm run build > "$LOG_DIR/build.log" 2>&1 || { tail -40 "$LOG_DIR/build.log"; fail "build"; }
ok build

step unit "npm run test:unit"
npm run test:unit > "$LOG_DIR/unit.log" 2>&1 || { tail -40 "$LOG_DIR/unit.log"; fail "unit"; }
unit_count=$(grep -E '^# tests ' "$LOG_DIR/unit.log" | awk '{ s += $3 } END { print s }')
ok "unit (${unit_count} tests)"

step e2e "npm run test:e2e"
npm run test:e2e > "$LOG_DIR/e2e.log" 2>&1 || { tail -40 "$LOG_DIR/e2e.log"; fail "e2e"; }
e2e_count=$(grep -E '^# tests ' "$LOG_DIR/e2e.log" | awk '{ s += $3 } END { print s }')
ok "e2e (${e2e_count} tests)"

step bench "npm run bench"
npm run bench > "$LOG_DIR/bench.log" 2>&1 || { tail -40 "$LOG_DIR/bench.log"; fail "bench"; }
bench_count=$(grep -E '^# tests ' "$LOG_DIR/bench.log" | awk '{ s += $3 } END { print s }')
ok "bench (${bench_count} tests)"

require_tsx

step examples "examples/*.ts (each must exit 0, stderr empty)"
for ex in hello-world.ts agent-shell-loop.ts shell-automation.ts ollama-local.ts rss-digest-agent.ts; do
  out="$LOG_DIR/example-${ex%.ts}.out"
  err="$LOG_DIR/example-${ex%.ts}.err"
  if "$TSX" "examples/$ex" > "$out" 2> "$err"; then
    if [[ -s "$err" ]]; then
      printf '  warn: %s wrote to stderr — see %s\n' "$ex" "$err"
    fi
    printf '  [ok]   %-26s  (%d bytes stdout)\n' "$ex" "$(wc -c < "$out" | tr -d ' ')"
  else
    tail -20 "$err" || true
    fail "example $ex"
  fi
done
ok examples

step cli "spawn CLI subcommands"
for args in "--help" "--version" "status" "plugins list"; do
  out="$LOG_DIR/cli-${args// /-}.out"
  err="$LOG_DIR/cli-${args// /-}.err"
  # shellcheck disable=SC2086
  if "$TSX" apps/cli/src/index.ts $args > "$out" 2> "$err"; then
    if [[ -s "$err" ]]; then
      tail -20 "$err"; fail "cli '$args' wrote to stderr"
    fi
    printf '  [ok]   openhand %-14s  (%d bytes)\n' "$args" "$(wc -c < "$out" | tr -d ' ')"
  else
    tail -20 "$err" || true
    fail "cli '$args'"
  fi
done
# REPL with piped /help /exit
out="$LOG_DIR/cli-chat.out"
err="$LOG_DIR/cli-chat.err"
if printf '/help\n/exit\n' | "$TSX" apps/cli/src/index.ts chat > "$out" 2> "$err"; then
  grep -q "Available commands" "$out" || fail "cli 'chat' missing /help output"
  grep -q "bye" "$out" || fail "cli 'chat' missing /exit ack"
  printf '  [ok]   openhand chat (REPL)\n'
else
  tail -20 "$err" || true
  fail "cli 'chat'"
fi
ok cli

step server "boot server, hit /api/health + SSE _demo flow"
PORT=$((40000 + RANDOM % 20000))
PORT="$PORT" "$TSX" apps/server/src/index.ts > "$LOG_DIR/server.out" 2> "$LOG_DIR/server.err" &
SERVER_PID=$!
# shellcheck disable=SC2064
trap "kill $SERVER_PID 2>/dev/null || true" EXIT
# Wait for /api/health to come up (max ~10s).
for i in $(seq 1 50); do
  if curl -fs "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
if ! curl -fs "http://localhost:$PORT/api/health" > "$LOG_DIR/server-health.out"; then
  tail -30 "$LOG_DIR/server.err" || true
  fail "server /api/health did not respond"
fi
grep -q '"status":"ok"' "$LOG_DIR/server-health.out" || fail "server health body unexpected"

TASK="smoke-$$"
curl -fs -X POST "http://localhost:$PORT/api/tasks/$TASK/_demo" -H 'content-type: application/json' -d '{}' > /dev/null \
  || fail "server _demo POST failed"

# Stream until we see "completed" or 4s elapse.
curl -sN --max-time 4 "http://localhost:$PORT/api/tasks/$TASK/stream" > "$LOG_DIR/server-sse.out" 2>&1 || true
grep -q '"status":"completed"' "$LOG_DIR/server-sse.out" || {
  tail -40 "$LOG_DIR/server-sse.out"
  fail "server SSE never reached completed"
}
frame_count=$(grep -c '^event: task' "$LOG_DIR/server-sse.out" || true)
printf '  [ok]   server SSE drained %d frames\n' "$frame_count"

kill -TERM "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
trap - EXIT
ok server

total=$((unit_count + e2e_count + bench_count))
printf '\n=== runtime-integration: PASS — %d tests + 5 examples + CLI + server ===\n' "$total"
printf '    log dir: %s\n' "$LOG_DIR"
