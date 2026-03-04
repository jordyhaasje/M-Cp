# Remote MCP Setup (Aanbevolen)

## Doel
Eindgebruikers verbinden zonder lokale server-setup:
1. HTTPS MCP URL
2. OAuth (aanbevolen) of API token

Shopify credentials blijven altijd server-side in de license service.

## Klantflow (nieuwe onboarding)
1. Open: `https://hazify-license-service-production.up.railway.app/onboarding`
2. Kies één van de twee kaarten: `Inloggen` of `Account maken`
3. Vul je accountgegevens in op `/login` of `/signup`
4. Na succesvolle sessie opent automatisch `/dashboard`
5. Vul store-koppeling in:
   - `shopDomain`
   - `shopClientId + shopClientSecret` of `shopAccessToken`
6. Dashboard toont daarna:
   - overzicht van alle gekoppelde winkels binnen hetzelfde account
   - switchen van actieve winkel zonder opnieuw in te loggen
   - app-cards met één primaire actie `Connect`
   - actieve app-koppelingen met directe connect-acties en klembord fallback

Dashboard API endpoints (account-sessie via `hz_user_session` cookie):
- `GET /v1/account/me`
- `POST /v1/account/signup`
- `POST /v1/account/login`
- `POST /v1/account/logout`
- `GET /v1/session/bootstrap`
- `GET /v1/dashboard/state`
- `POST /v1/dashboard/mcp-token/create`
- `POST /v1/dashboard/mcp-token/revoke`

## One-click connect (ondersteunde clients)
- Cursor:
  - gebruikt `https://cursor.com/en-US/install-mcp?...` install-link
  - server wordt direct toegevoegd met HTTP MCP URL
- VS Code:
  - gebruikt `vscode:mcp/install?...` deeplink
  - server wordt direct toegevoegd in MCP configuratie
- ChatGPT:
  - opent direct de connector setup
  - daarna alleen MCP URL invullen + OAuth selecteren
  - OAuth Client ID/Secret kunnen leeg blijven (dynamic registration)
- Claude/Other:
  - gebruiken connect-actie met automatische klembord fallback waar nodig
- Deeplink fallback:
  - als deeplink niet opent, staat de juiste configuratie direct op het klembord

## Authenticatieopties

### 1) OAuth (aanbevolen, o.a. ChatGPT)
Gebruik alleen de MCP URL. Client doet daarna OAuth discovery + browser autorisatie.

MCP endpoint:
- `https://hazify-mcp-remote-production.up.railway.app/mcp`

OAuth discovery endpoints:
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/.well-known/openid-configuration`

OAuth auth server endpoints:
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`

Compat aliases bestaan ook voor oudere clients:
- `/register`, `/authorize`, `/token`

### 2) API token (header/bearer)
Voor clients zonder OAuth of voor snelle tests.

Voorbeeld (`mcp-remote`):
```json
{
  "command": "npx",
  "args": [
    "-y",
    "mcp-remote",
    "https://hazify-mcp-remote-production.up.railway.app/mcp",
    "--transport",
    "http-only",
    "--header",
    "x-api-key: ${HAZIFY_MCP_TOKEN}"
  ],
  "env": {
    "HAZIFY_MCP_TOKEN": "hzmcp_REPLACE_ME"
  },
  "useBuiltInNode": true
}
```

## Tenant-gedrag
- Zelfde `licenseKey` + zelfde `shopDomain` -> bestaande tenant update
- Zelfde `licenseKey` + ander `shopDomain` -> nieuwe tenant (voorkomt overschrijven)
- Dashboard `GET /v1/dashboard/state?tenantId=<id>` wisselt actieve winkelcontext

## Snelle validatie
1. `initialize` werkt
2. `tools/list` geeft tools terug
3. `get-license-status` werkt
4. OAuth flow kan code + token uitwisselen

## Veelvoorkomende fouten

### `Cannot POST /register`
Oorzaak:
- oude/onjuiste OAuth discovery of ontbrekende metadata

Fix:
1. Gebruik exact de MCP URL op `/mcp`
2. Controleer dat remote service up-to-date is (heeft `.well-known` endpoints)
3. Voeg connector opnieuw toe

### `Error fetching OAuth configuration`
Oorzaak:
- client probeert OAuth, maar endpoint wijst naar een oude deploy

Fix:
- controleer dat de URL exact is: `https://hazify-mcp-remote-production.up.railway.app/mcp`

### `Error creating connector ... client_secret Input should be a valid string`
Oorzaak:
- OAuth Dynamic Client Registration response bevatte `client_secret: null`

Fix:
1. Gebruik de nieuwste deploy (DCR geeft nu altijd string `client_secret`)
2. Verwijder oude connector en maak opnieuw aan
3. Laat in ChatGPT `OAuth Client ID/Secret` leeg als je dynamic registration gebruikt

### `Shopify app not installed on ...`
Oorzaak:
- tenant gebruikt client credentials voor shop waar app niet is geautoriseerd

Fix:
1. Onboarding opnieuw met juiste `shopDomain`
2. Of `shopAccessToken` gebruiken
3. Of app eerst installeren/authoriseren op die shop

## Vereiste remote variabelen

### Hazify MCP service
- `HAZIFY_MCP_TRANSPORT=http`
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY`
- `HAZIFY_MCP_PUBLIC_URL` (aanbevolen)
- `HAZIFY_MCP_AUTH_SERVER_URL` (aanbevolen)
- `PORT`

### License service
- `HAZIFY_FREE_MODE=true`
- `ADMIN_API_KEY`
- `MCP_API_KEY`
- `PUBLIC_BASE_URL`
- `MCP_PUBLIC_URL`
- `DATABASE_URL` (aanbevolen productie)
- `DATABASE_SSL` (optioneel, standaard true)
- `DB_POOL_MAX` (optioneel)
- `DB_STATEMENT_TIMEOUT_MS` (optioneel)
- `DATA_ENCRYPTION_KEY` (optioneel, versleutelt shop credentials in PostgreSQL)
- `BACKUP_EXPORT_KEY` (optioneel, versleutelt admin exports)
- `OAUTH_ISSUER` (optioneel, voor vaste issuer URL)
- `OAUTH_ACCESS_TOKEN_TTL_SECONDS` (optioneel)
- `OAUTH_REFRESH_TOKEN_TTL_DAYS` (optioneel)
- `OAUTH_CODE_TTL_MINUTES` (optioneel)
- `PORT`

Belangrijk:
- Als `DATABASE_URL` ontbreekt in productie valt de service terug op JSON-opslag en zijn account/OAuth-data niet betrouwbaar persistent bij redeploy/restart.
- Bij PostgreSQL met lege dataset probeert de service éénmalig legacy JSON-data vanaf `LICENSE_DB_PATH` te importeren (als die file bestaat).
