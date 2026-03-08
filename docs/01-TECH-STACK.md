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
- OAuth authorization server (`/oauth/register`, `/oauth/authorize`, `/oauth/token`)

Belangrijk:
- Shopify credentials blijven server-side
- Ondersteunt beide vormen: `shopAccessToken` en BYO `shopClientId` + `shopClientSecret`
- Onboarding valideert verplichte Shopify scopes inclusief `read_themes` en `write_themes`
- In productie zijn `DATABASE_URL` en `DATA_ENCRYPTION_KEY` verplicht

## MCP Remote Service
Pad: `apps/hazify-mcp-remote/src/index.js`

Verantwoordelijkheden:
- MCP endpoint op `/mcp`
- token introspectie bij license service
- OAuth discovery metadata
- tool-executie binnen tenant context

Belangrijk:
- Remote `/mcp` over Streamable HTTP is leidend
- stdio/local blijft alleen fallback
- `/mcp` accepteert alleen `Authorization: Bearer` of `x-api-key`
- Origin allowlist check is actief bij requests met `Origin` header
- per-tenant serialisatie voor muterende tools

## Runtime/Platform
- Node.js 18+
- ESM modules
- npm workspaces op repo root
- Railway voor productie deploy
