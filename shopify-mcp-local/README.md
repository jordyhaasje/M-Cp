# Hazify MCP Server (Shopify)

Remote MCP-service voor Shopify tooling in deze workspace. Deze service draait achter `hazify-license-service` en gebruikt token-introspectie voor tenant-context.

## Scope
- Productie-entrypoint: `dist/index.js`
- Transport: MCP Streamable HTTP op `/mcp`
- Shopify-auth: credentials worden via introspectie opgehaald (server-side)

## Security defaults
- `/mcp` accepteert alleen:
  - `Authorization: Bearer <token>`
  - `x-api-key: <token>`
- Query-tokenvarianten (`?token=`, `?api_key=`) worden geweigerd.
- Non-Bearer `Authorization` wordt geweigerd.
- Requests met `Origin` header worden gevalideerd tegen `HAZIFY_MCP_ALLOWED_ORIGINS` (of server-origin fallback).
- `WWW-Authenticate` bevat `resource_metadata` bij `401` responses.
- OAuth metadata adverteert alleen `code_challenge_methods_supported: ["S256"]`.

## Belangrijke runtime variabelen
- `HAZIFY_MCP_TRANSPORT=http`
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY`
- `HAZIFY_MCP_PUBLIC_URL` (aanbevolen)
- `HAZIFY_MCP_AUTH_SERVER_URL` (aanbevolen)
- `HAZIFY_MCP_ALLOWED_ORIGINS` (optioneel, comma-separated)
- `PORT`

## Lokaal starten (remote mode)
```bash
cd /Users/jordy/Desktop/Customer\ service/shopify-mcp-local
node dist/index.js --transport=http
```

## Toolingregels (operationeel)
- `clone-product-from-url`
  - default `status` is `DRAFT`
  - output bevat `variantMediaMapping` met verificatie-status
- theme section flow
  - `read-theme-files` voor context/verify
  - `validate-theme-section` vóór elke write
  - `upsert-theme-section` voor `sections/*.liquid`
  - `upsert-theme-section-pack` voor section pack uploads (`sections/<id>.liquid` + `assets/sections-library/<id>/styles.css` + optionele snippets/assets)
  - `inject-section-into-template` voor `templates/*.json`
  - writes naar live theme (`role=MAIN`) vereisen:
    - `liveWrite=true`
    - `confirm_live_write=true`
    - `confirmation_reason`
    - `change_summary`
- tracking updates (`set-order-tracking`, `update-fulfillment-tracking`, tracking via `update-order`)
  - carrier moet exact ondersteund zijn of resolvebare alias
  - ongeldige carrier geeft harde validatiefout
- `refund-order`
  - vereist `audit` object met `amount`, `reason`, `scope`
  - audit note wordt in refund note opgenomen

## Tests
```bash
npm test
```

Testset bevat o.a.:
- MCP HTTP auth hardening tests
- tool hardening tests (clone mapping, tracking carrier strictness, refund audit)
- theme tools tests (validate/upsert/inject/read + live guard + path/size checks)
- section-pack tests (conflict preflight + consented overwrite + styles/snippets/assets write)
- license/url security unit tests
