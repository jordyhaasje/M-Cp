# Hazify License Service

Auth, onboarding, OAuth, token-introspectie, interne token-exchange, billing en admin operations voor Hazify MCP.

## Start
```bash
npm run --workspace @hazify/license-service start
```

Runtime: Node.js `>=22.12.0`.

Repo-root variant:
```bash
HAZIFY_SERVICE_MODE=license npm start
```

## Belangrijkste endpoints
- `POST /v1/account/signup`
- `POST /v1/account/login`
- `POST /v1/onboarding/connect-shopify`
- `POST /v1/dashboard/mcp-token/create`
- `POST /v1/dashboard/mcp-token/revoke`
- `POST /v1/mcp/token/introspect`
- `POST /v1/mcp/token/exchange`
- `POST /oauth/register`
- `GET|POST /oauth/authorize`
- `POST /oauth/token`
- `GET /v1/billing/readiness`
- `POST /v1/billing/create-checkout-session`
- `POST /v1/billing/create-portal-session`
- `POST /v1/stripe/webhook`
- `GET /v1/admin/readiness`
- `POST /v1/admin/storage/export`

OAuth-notitie:
- `GET|POST /oauth/authorize` canonicaliseert nu semantisch gelijke MCP scopes tijdens de form roundtrip, zodat clients zoals Codex niet stuklopen op andere volgorde van `scope`-tokens of een extra `offline_access` echo in query versus form body.
- Alleen `mcp:tools`, `mcp:tools:read` en `mcp:tools:write` zijn geldige MCP scopes. Onbekende `mcp:*` tokens worden geweigerd.
- OAuth tokens worden aan de MCP resource URL gebonden; clients moeten dezelfde publieke `/mcp` resource blijven gebruiken.
- Productie-start van de License Service wacht bij rolling deploys nu kort op de Postgres single-writer lock in plaats van meteen te crashen terwijl de vorige writer nog netjes afbouwt.

## Shopify auth modes
- `shopAccessToken`: primaire route voor merchant-created Shopify custom apps. Gebruik de Admin API access token uit Shopify Admin.
- `shopClientId` + `shopClientSecret`: ondersteund voor trusted app-achtige setups, maar niet de standaardroute voor merchant-created custom apps.

Vereiste Shopify scopes volgen `REQUIRED_SHOPIFY_ADMIN_SCOPES`, inclusief `read_themes`, `write_themes`, `read_fulfillments`, `read_merchant_managed_fulfillment_orders` en `write_merchant_managed_fulfillment_orders`.

Introspection (`/v1/mcp/token/introspect`) geeft alleen minimale metadata terug en geen Shopify secrets.
Interne service-to-service token exchange (`/v1/mcp/token/exchange`) levert de Shopify access token voor de remote MCP service.

## Productievereisten
- `DATABASE_URL` verplicht
- `DATA_ENCRYPTION_KEY` verplicht
- `HAZIFY_FREE_MODE=false` verplicht
- `MCP_API_KEY` verplicht
- `ADMIN_API_KEY` verplicht
- `PUBLIC_BASE_URL` verplicht
- `MCP_PUBLIC_URL` verplicht
- Stripe-variabelen zijn nodig wanneer billing actief moet zijn

## Interne structuur
- `src/server.js` - HTTP entrypoint, shared helpers en route-registratie
- `src/config/` - runtime-config en env-validatie
- `src/domain/` - license-, tenant- en accounthelpers
- `src/lib/` - pure helpers voor tijd, OAuth, cookies en protocolgedrag
- `src/routes/` - routeclusters voor `public-ui`, `dashboard`, `account`, `license-billing`, `admin` en `oauth`
- `src/services/` - billing/readiness helpers en account-sessies
- `src/repositories/` - opslaglaag (Postgres-only persistence, geen JSON-adapter)
- `src/views/` - dashboard, login en onboarding HTML renderers

## Tests
```bash
npm run --workspace @hazify/license-service test
```
