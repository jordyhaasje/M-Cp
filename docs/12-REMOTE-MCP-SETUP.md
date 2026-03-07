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
   - masked overzicht van actieve winkel-credentials (client id/secret/access token)
   - winkel verwijderen vanuit dashboard (incl. intrekken actieve auth artifacts)
   - app-cards met één primaire actie `Connect`
   - actieve app-koppelingen met directe connect-acties, intrekken per client en klembord fallback

Dashboard API endpoints (account-sessie via `hz_user_session` cookie):
- `GET /v1/account/me`
- `POST /v1/account/signup`
- `POST /v1/account/login`
- `POST /v1/account/logout`
- `GET /v1/session/bootstrap`
- `GET /v1/dashboard/state`
- `POST /v1/dashboard/mcp-token/create`
- `POST /v1/dashboard/mcp-token/revoke`
- `POST /v1/dashboard/oauth/revoke`
- `POST /v1/dashboard/tenant/delete`

## Shopify app vereisten (copy-paste)
Deze scopes dekken alle huidige MCP-tools in `shopify-mcp-local/dist/tools`.

Scopes:
```text
read_products,write_products,read_customers,write_customers,read_orders,write_orders,read_fulfillments,read_inventory,write_merchant_managed_fulfillment_orders,read_themes,write_themes
```

Redirect URL's:
```text
http://127.0.0.1:8787/oauth/shopify/callback
http://localhost:8787/oauth/shopify/callback
```

Belangrijk:
- Onboarding valideert credentials nu live (token exchange + scope-check) voordat tenant-data wordt opgeslagen.
- Theme section tooling (`read-theme-files`, `validate-theme-section`, `upsert-theme-section`, `inject-section-into-template`) vereist `read_themes` + `write_themes`.
- Section-pack upload tooling (`upsert-theme-section-pack`) vereist ook `read_themes` + `write_themes`.
- `read_returns` en `write_order_edits` zijn optioneel voor de huidige codebase.
- `read_all_orders` telt ook als order-read scope.

## Connectflows per client
- Dashboard UX gebruikt nu tabs per setup-formaat (zoals Stripe): `Streamable URL`, `JSON config`, `Command` waar relevant.
- VS Code:
  - gebruikt deeplink: `https://vscode.dev/redirect/mcp/install?name=...&config=<url-encoded-json>`
  - servernaam in clients: `Hazify MCP`
  - browserautorisatie via OAuth volgt daarna (geen vooraf ingevulde API-key)
- Cursor:
  - gebruikt deeplink: `cursor://anysphere.cursor-deeplink/mcp/install?name=...&config=<base64-json>`
  - browserautorisatie via OAuth volgt daarna (geen vooraf ingevulde API-key)
- ChatGPT:
  - open connector setup en plak alleen de MCP URL
  - OAuth Client ID/Secret leeg laten (dynamic registration)
- Claude:
  - open officiële connectorpagina: `https://claude.ai/settings/connectors`
  - plak MCP URL en rond browserautorisatie af
  - geen publieke one-click deeplink voor auto-installatie in Claude web
- Perplexity:
  - gebruik `Custom Remote Connector`
  - zet transport op `Streamable HTTP` (SSE geeft 400 op `/mcp`)
  - kies bij voorkeur `OAuth 2.0`; gebruik API-key fallback als OAuth in de client niet start
  - geen publieke one-click deeplink voor auto-installatie in Perplexity

## Authenticatieopties

### 1) OAuth (aanbevolen, o.a. ChatGPT)
Gebruik alleen de MCP URL. Client doet daarna OAuth discovery + browser autorisatie.

OAuth security defaults:
- PKCE is verplicht.
- Alleen `S256` is toegestaan als `code_challenge_method`.
- Scope is vast op `mcp:tools`.
- OAuth authorize-submit gebruikt same-origin form submit (`action=""`) voor compatibiliteit met geproxyde browserflows in LLM clients (zoals ChatGPT/Claude/Perplexity webviews).
- CSP `form-action` op OAuth-pagina’s staat expliciet loopback callback origins toe (`http://127.0.0.1:*`, `http://localhost:*`, `http://[::1]:*`) plus toegestane custom redirect schemes (zoals `vscode:`), zodat native clients kunnen afronden.
- OAuth login/authorize routes staan framed toe voor bekende LLM-origins (ChatGPT/Claude/Perplexity), met strikte allowlist.

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
Alleen voor clients zonder bruikbare OAuth-flow of voor diagnostiek.

Belangrijk:
- Alleen `Authorization: Bearer ...` en `x-api-key` worden geaccepteerd op `/mcp`.
- Query-tokenvarianten zoals `?token=` of `?api_key=` worden geweigerd.

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

## Multi-MCP section builder flow (Chrome MCP + Hazify MCP)
Belangrijk:
- De remote Shopify MCP kan je lokale Chrome MCP niet direct aanroepen.
- De AI-client orkestreert beide MCP’s in dezelfde sessie.

Aanbevolen flow:
1. Gebruik Chrome MCP om DOM/CSS/scripts van referentiepagina op te halen.
2. Laat de client section liquid genereren (met geldig `{% schema %}` blok).
3. Gebruik `validate-theme-section` (preflight).
4. Gebruik `upsert-theme-section-pack` om section + styles (+ optionele snippets/assets) te schrijven.
5. Gebruik `inject-section-into-template` alleen als `targetTemplate` niet in stap 4 is meegegeven.
6. Verifieer met `read-theme-files`.

Section-pack paden:
- `sections/<id>.liquid`
- `assets/sections-library/<id>/styles.css`
- optioneel `snippets/<id>--*.liquid`
- optioneel `assets/sections-library/<id>/*.(css|js|json|txt|svg)`

Live theme guard:
- Bij `theme.role=MAIN` moet je expliciet meesturen:
  - `liveWrite=true`
  - `confirm_live_write=true`
  - `confirmation_reason`
  - `change_summary`
- Zonder deze velden wordt de write hard geblokkeerd.

MCP-native instructies:
- Resource: `hazify://catalog/tools`
- Resource: `hazify://playbooks/theme-safety`
- Prompt: `hazify-theme-section-playbook`

Perplexity fallback (als OAuth in de app niet start):
```json
{
  "mcpServers": {
    "Hazify MCP": {
      "url": "https://hazify-mcp-remote-production.up.railway.app/mcp",
      "headers": {
        "x-api-key": "hzmcp_REPLACE_ME"
      }
    }
  }
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

### `Deze koppeling is verlopen` (meestal VS Code/Cursor met oude client-id)
Oorzaak:
- client probeert een oude lokaal gecachete OAuth-client-id te gebruiken

Fix:
1. Klik opnieuw op `Connect` vanuit dashboard om een geldige reconnect-flow te starten
2. Blijft het terugkomen: verwijder de oude connector in de client en voeg opnieuw toe
3. Voor native app-callbacks (zoals `vscode://...`) ondersteunt de server nu ook custom redirect schemes via allowlist

### `400 Bad Request: missing mcp-session-id` (vaak Perplexity)
Oorzaak:
- connector gebruikt verkeerde transportmodus (meestal SSE i.p.v. Streamable HTTP)

Fix:
1. Open connector instellingen
2. Zet transport op `Streamable HTTP`
3. Gebruik endpoint `https://hazify-mcp-remote-production.up.railway.app/mcp`

### Claude: geen plek om connector toe te voegen
Oorzaak:
- je zit niet in `claude.ai` web settings, of workspace-admin heeft custom integrations geblokkeerd

Fix:
1. Open `https://claude.ai/settings/connectors`
2. Controleer admin policy voor custom integrations (Team/Enterprise)

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

### `Target theme is live (MAIN)...`
Oorzaak:
- Je schrijft naar het live theme zonder verplichte confirm velden

Fix:
1. Voeg `liveWrite=true` toe
2. Voeg `confirm_live_write=true` toe
3. Voeg `confirmation_reason` + `change_summary` toe
4. Of schrijf eerst naar een niet-live theme

## Vereiste remote variabelen

### Hazify MCP service
- `HAZIFY_MCP_TRANSPORT=http`
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY`
- `HAZIFY_MCP_PUBLIC_URL` (aanbevolen)
- `HAZIFY_MCP_AUTH_SERVER_URL` (aanbevolen)
- `HAZIFY_MCP_ALLOWED_ORIGINS` (optioneel, comma-separated allowlist voor `Origin` op `/mcp`)
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
- `OAUTH_ALLOWED_CUSTOM_REDIRECT_SCHEMES` (optioneel, default: `vscode,cursor,claude,perplexity`)
- `OAUTH_ACCESS_TOKEN_TTL_SECONDS` (optioneel)
- `OAUTH_REFRESH_TOKEN_TTL_DAYS` (optioneel)
- `OAUTH_CODE_TTL_MINUTES` (optioneel)
- `MAX_BODY_BYTES` (optioneel, default 1048576)
- `PORT`

Belangrijk:
- Als `DATABASE_URL` ontbreekt in productie valt de service terug op JSON-opslag en zijn account/OAuth-data niet betrouwbaar persistent bij redeploy/restart.
- Bij PostgreSQL met lege dataset probeert de service éénmalig legacy JSON-data vanaf `LICENSE_DB_PATH` te importeren (als die file bestaat).
