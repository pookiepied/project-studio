#!/usr/bin/env bash
set -euo pipefail

# Run this script from a terminal on the VPS host, not from the OpenCode
# container. The host must have Node.js, pnpm, and Wrangler's local runtime.

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="$ROOT_DIR/UI"
LOG_DIR="${STUDIO_GATEWAY_LOG_DIR:-$ROOT_DIR/.local-logs}"

mkdir -p "$LOG_DIR"

cleanup() {
  trap - INT TERM EXIT
  if [[ -n "${GATEWAY_PID:-}" ]]; then kill "$GATEWAY_PID" 2>/dev/null || true; fi
  if [[ -n "${UI_PID:-}" ]]; then kill "$UI_PID" 2>/dev/null || true; fi
}
trap cleanup INT TERM EXIT

(
  cd "$ROOT_DIR"
  pnpm db:migrate --local
  exec pnpm dev --ip 0.0.0.0
) >"$LOG_DIR/gateway.log" 2>&1 &
GATEWAY_PID=$!

(
  cd "$UI_DIR"
  exec pnpm dev --host 0.0.0.0
) >"$LOG_DIR/ui.log" 2>&1 &
UI_PID=$!

printf '%s\n' "Gateway: http://0.0.0.0:8787"
printf '%s\n' "UI:      http://0.0.0.0:4173"
printf '%s\n' "Logs:    $LOG_DIR"
printf '%s\n' "Press Ctrl-C to stop both processes."

wait -n "$GATEWAY_PID" "$UI_PID"
