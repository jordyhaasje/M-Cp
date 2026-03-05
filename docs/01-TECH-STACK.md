# Tech Stack (Productie)

## Overzicht
Deze workspace draait als een 2-service architectuur:
1. `hazify-license-service` (Node.js HTTP service)
2. `shopify-mcp-local` (Node.js MCP server over HTTP transport)

Doel: gebruikers koppelen via één remote MCP URL met OAuth-first authenticatie.

## Runtime en platform
- Taal: JavaScript (ESM)
- Runtime: Node.js (Railway deploys draaien op Node 18/22 afhankelijk van service config)
- Hosting: Railway
- Protocol: MCP Streamable HTTP

## Service 1: License Service
Pad: `hazify-license-service/server.js`

Verantwoordelijkheden:
- onboarding + dashboard UI (`/onboarding`, `/dashboard`)
- licentie- en tenantbeheer
- uitgifte van MCP bearer tokens
- dashboard sessie-auth + multi-store context (`/v1/dashboard/*`)
- OAuth authorization server:
  - `/.well-known/oauth-authorization-server`
  - `/.well-known/openid-configuration`
  - `/oauth/register`
  - `/oauth/authorize`
  - `/oauth/token`
- introspectie endpoint voor MCP service:
  - `/v1/mcp/token/introspect`

Data-opslag:
- Primair: PostgreSQL via `DATABASE_URL`
- Fallback voor lokale dev: JSON datastore via `LICENSE_DB_PATH`
- domeinen: licenses, tenants, mcpTokens, oauthClients, oauthAuthCodes, oauthRefreshTokens, accounts, accountSessions
- exports/backups: admin endpoint `/v1/admin/storage/export` (versleuteld als `BACKUP_EXPORT_KEY` is gezet)
- licenses zijn schema-ready voor Stripe subscription velden (`subscription.*`) naast legacy `stripeCustomerId`/`stripeSubscriptionId`
- safety-net: bij PostgreSQL met lege state probeert de service eenmalig legacy JSON (`LICENSE_DB_PATH`) te importeren als die file bestaat

Belangrijk:
- Shopify credentials blijven server-side (niet in clientconfig)
- Dynamic Client Registration retourneert altijd string `client_secret` (ChatGPT compat)
- Native app redirect URI schemes (zoals `vscode://...`) zijn toegestaan via `OAUTH_ALLOWED_CUSTOM_REDIRECT_SCHEMES`
- In productie is `DATABASE_URL` feitelijk verplicht voor persistente accounts/sessies/OAuth-clients

## Service 2: MCP Remote Service
Pad: `shopify-mcp-local/dist/index.js`

Verantwoordelijkheden:
- MCP endpoint: `/mcp`
- tool-executie voor Shopify MCP tools
- auth context via token introspectie naar license service
- OAuth metadata/protected resource endpoints:
  - `/.well-known/oauth-authorization-server`
  - `/.well-known/openid-configuration`
  - `/.well-known/oauth-protected-resource`
- legacy compat routes:
  - `/register`, `/authorize`, `/token` (redirect naar auth server)

Belangrijk:
- `401` + `WWW-Authenticate` met `resource_metadata` bij missende/ongeldige token
- per-tenant serialization lock voor tool-mutaties

## Externe integraties
- Shopify Admin GraphQL API
- OpenAI/ChatGPT connector clients
- Cursor MCP install deeplink (OAuth-first)
- VS Code MCP install deeplink (OAuth-first)
- Claude connectorflow via `claude.ai/settings/connectors` (OAuth-first)

## Productie endpoints
- License service: `https://hazify-license-service-production.up.railway.app`
- MCP endpoint: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Security model
- OAuth-first voor moderne clients
- header/bearer token fallback voor legacy clients
- tenant-isolatie op license + shopdomain
- geen Shopify secrets in eindgebruiker-config
