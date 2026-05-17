#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${HAZIFY_LANGFLOW_MCP_PORT:-8788}"
HOST="${HAZIFY_MCP_HTTP_HOST:-127.0.0.1}"
LOG_FILE="${HAZIFY_LANGFLOW_MCP_LOG:-/tmp/hazify-langflow-mcp.log}"

export PORT
export HAZIFY_MCP_HTTP_PORT="${HAZIFY_MCP_HTTP_PORT:-$PORT}"
export HAZIFY_MCP_HTTP_HOST="$HOST"

if [[ -z "${HAZIFY_MCP_API_KEY:-}" ]]; then
  echo "HAZIFY_MCP_API_KEY is required for the local Hazify MCP server. Run this script through Railway env injection or set it locally." >&2
  exit 1
fi

if [[ -z "${HAZIFY_MCP_CLIENT_TOKEN:-${HAZIFY_MCP_TOKEN:-}}" ]]; then
  echo "HAZIFY_MCP_CLIENT_TOKEN is required for MCP client authentication." >&2
  exit 1
fi

port_is_open() {
  (echo >"/dev/tcp/${HOST}/${PORT}") >/dev/null 2>&1
}

cd "$ROOT_DIR"

if ! port_is_open; then
  npm run start:mcp >"$LOG_FILE" 2>&1 &

  for _ in {1..40}; do
    if port_is_open; then
      break
    fi
    sleep 0.5
  done
fi

if ! port_is_open; then
  echo "Hazify MCP local server did not start on ${HOST}:${PORT}. See ${LOG_FILE}." >&2
  exit 1
fi

exec node "$ROOT_DIR/scripts/langflow/hazify-mcp-stdio-bridge.mjs" "http://${HOST}:${PORT}/mcp"
