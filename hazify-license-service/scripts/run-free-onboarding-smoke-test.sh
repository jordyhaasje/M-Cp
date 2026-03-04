#!/usr/bin/env bash
set -euo pipefail

LICENSE_API_BASE="${LICENSE_API_BASE:-https://hazify-license-service-production.up.railway.app}"
MCP_URL="${MCP_URL:-https://hazify-mcp-remote-production.up.railway.app/mcp}"
SHOP_DOMAIN="${SHOP_DOMAIN:-}"
SHOP_ACCESS_TOKEN="${SHOP_ACCESS_TOKEN:-}"
SHOP_CLIENT_ID="${SHOP_CLIENT_ID:-}"
SHOP_CLIENT_SECRET="${SHOP_CLIENT_SECRET:-}"
CONTACT_EMAIL="${CONTACT_EMAIL:-}"
LABEL="${LABEL:-Smoke test}"
LICENSE_KEY="${LICENSE_KEY:-}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if [[ -z "$SHOP_DOMAIN" ]]; then
  echo "Set SHOP_DOMAIN (example: your-store.myshopify.com)" >&2
  exit 1
fi

if [[ -z "$SHOP_ACCESS_TOKEN" ]] && ([[ -z "$SHOP_CLIENT_ID" ]] || [[ -z "$SHOP_CLIENT_SECRET" ]]); then
  echo "Provide SHOP_ACCESS_TOKEN or SHOP_CLIENT_ID + SHOP_CLIENT_SECRET" >&2
  exit 1
fi

build_onboarding_payload() {
  if [[ -n "$SHOP_ACCESS_TOKEN" ]]; then
    jq -n \
      --arg licenseKey "$LICENSE_KEY" \
      --arg contactEmail "$CONTACT_EMAIL" \
      --arg shopDomain "$SHOP_DOMAIN" \
      --arg shopAccessToken "$SHOP_ACCESS_TOKEN" \
      --arg label "$LABEL" \
      '{licenseKey:$licenseKey, contactEmail:$contactEmail, shopDomain:$shopDomain, shopAccessToken:$shopAccessToken, label:$label}'
  else
    jq -n \
      --arg licenseKey "$LICENSE_KEY" \
      --arg contactEmail "$CONTACT_EMAIL" \
      --arg shopDomain "$SHOP_DOMAIN" \
      --arg shopClientId "$SHOP_CLIENT_ID" \
      --arg shopClientSecret "$SHOP_CLIENT_SECRET" \
      --arg label "$LABEL" \
      '{licenseKey:$licenseKey, contactEmail:$contactEmail, shopDomain:$shopDomain, shopClientId:$shopClientId, shopClientSecret:$shopClientSecret, label:$label}'
  fi
}

ONBOARD_PAYLOAD="$(build_onboarding_payload)"
ONBOARD_JSON="$(curl -sS -X POST "$LICENSE_API_BASE/v1/onboarding/connect-shopify" -H 'content-type: application/json' -d "$ONBOARD_PAYLOAD")"
TOKEN="$(echo "$ONBOARD_JSON" | jq -r '.mcp.bearerToken // empty')"
GENERATED_LICENSE="$(echo "$ONBOARD_JSON" | jq -r '.licenseKey // empty')"

if [[ -z "$TOKEN" ]]; then
  echo "Onboarding failed:" >&2
  echo "$ONBOARD_JSON" | jq . >&2 || echo "$ONBOARD_JSON" >&2
  exit 1
fi

INIT_HEADERS_FILE="$(mktemp)"
INIT_BODY_FILE="$(mktemp)"
TOOLS_BODY_FILE="$(mktemp)"

curl -sS -D "$INIT_HEADERS_FILE" -o "$INIT_BODY_FILE" \
  -X POST "$MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-05","capabilities":{},"clientInfo":{"name":"free-onboarding-smoke-test","version":"1.0.0"}}}' >/dev/null

SESSION_ID="$(rg -i 'mcp-session-id:' "$INIT_HEADERS_FILE" | awk '{print $2}' | tr -d '\r')"

if [[ -z "$SESSION_ID" ]]; then
  echo "MCP initialize did not return mcp-session-id" >&2
  cat "$INIT_BODY_FILE" >&2
  exit 1
fi

curl -sS -o "$TOOLS_BODY_FILE" \
  -X POST "$MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "authorization: Bearer $TOKEN" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' >/dev/null

TOOLS_COUNT="$(jq -r '.result.tools | length' "$TOOLS_BODY_FILE" 2>/dev/null || echo '0')"

cat <<EOT
FREE ONBOARDING SMOKE TEST OK
- licenseKey: $GENERATED_LICENSE
- sessionId: $SESSION_ID
- mcpUrl: $MCP_URL
- toolsCount: $TOOLS_COUNT
EOT
