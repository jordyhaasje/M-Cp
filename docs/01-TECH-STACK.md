# Tech Stack (Productie)

## Architectuur
Deze monorepo bevat twee runtime services:
1. `apps/hazify-license-service` (Node.js HTTP service)
2. `apps/hazify-mcp-remote` (Node.js MCP service, Streamable HTTP op `/mcp`)

Gedeelde logica:
- `packages/shopify-core` (Shopify domain/auth/scope validatie)
- `packages/mcp-common` (hashing, URL/origin utilities)

## License Service
Pad: `apps/hazify-license-service/src/server.js`

Verantwoordelijkheden:
- account signup/login/logout en dashboard sessies
- onboarding (`/v1/onboarding/connect-shopify`)
- MCP token create/revoke + introspectie (`/v1/mcp/token/introspect`)
- interne Shopify token-exchange voor remote MCP (`/v1/mcp/token/exchange`)
- OAuth authorization server (`/oauth/register`, `/oauth/authorize`, `/oauth/token`)
- billing/Stripe checkout, portal en webhook verwerking
- admin/readiness/export routes voor operations

Belangrijk:
- Shopify credentials blijven server-side
- Ondersteunt beide vormen: `shopAccessToken` en BYO `shopClientId` + `shopClientSecret`
- Onboarding valideert verplichte Shopify scopes inclusief `read_themes` en `write_themes`
- In productie zijn `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `MCP_API_KEY`, `ADMIN_API_KEY`, `PUBLIC_BASE_URL`, `MCP_PUBLIC_URL` verplicht
- `DB_SINGLE_WRITER_ENFORCED=true` is de standaard en verplicht in productie
- In productie moet `HAZIFY_FREE_MODE=false` staan
- Postgres persistence gebruikt transactionele per-entity writes (upsert/delete), zonder `TRUNCATE + full reinsert`
- Single-writer consistency wordt afgedwongen met een Postgres advisory lock; dit is expliciet geen multi-writer/horizontale write-correctness model
- De service gebruikt nog een process-memory working set (`db`) per instance; externe DB-writers buiten deze service worden niet ondersteund als consistency-model

## MCP Remote Service
Pad: `apps/hazify-mcp-remote/src/index.js`

Verantwoordelijkheden:
- MCP endpoint op `/mcp`
- token introspectie + interne token-exchange bij license service
- OAuth discovery metadata
- tool-executie binnen tenant context
- theme-bestanden via Admin GraphQL theme management; REST Asset API blijft alleen als compat-fallback voor shops waar theme GraphQL nog niet beschikbaar is
- theme file batch data-plane voor remote deploy/verificatie (`upsert-theme-files`, `get-theme-files`, `verify-theme-files`)
- metadata discovery tool voor externe section-import workflows: `list_theme_import_tools`

Belangrijk:
- Remote `/mcp` over Streamable HTTP is leidend
- stdio/local blijft alleen expliciete fallback via `--transport=stdio` of `start:fallback:stdio`
- `/mcp` accepteert alleen `Authorization: Bearer` of `x-api-key`
- Origin allowlist check is actief bij requests met `Origin` header
- default session mode is stateless (`MCP_SESSION_MODE=stateless`)
- default context cache TTL in remote HTTP mode is 120s (`HAZIFY_MCP_CONTEXT_TTL_MS=120000`)
- `stateful` mode is opt-in en vereist sticky sessions of gedeelde session store
- Geen browser runtime of section import/generatie in deze service

## Runtime/Platform
- Node.js `>=22.12.0` vereist
- ESM modules
- npm workspaces op repo root
- Railway voor productie deploy
