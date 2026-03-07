# Hazify License Service

License API voor `hazify-mcp` remote hosting: onboarding, tenant-opslag en MCP token-introspectie.

## Productie URL's
- License service: `https://hazify-license-service-production.up.railway.app`
- MCP endpoint: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Standaard modus
- `HAZIFY_FREE_MODE=true`
- Geen checkout vereist
- Onboarding maakt direct een actieve license + token

## Endpoints

### Publiek
- `GET /` (landing)
- `GET /onboarding` (start met 2 cards: inloggen / account maken)
- `GET /login`
- `GET /signup`
- `GET /dashboard` (alleen met actieve sessie; anders redirect)
- `GET /logo.png` (onboarding brand logo)
- `GET /v1/billing/readiness`

### Account sessie
- `POST /v1/account/signup`
- `POST /v1/account/login`
- `POST /v1/account/logout`
- `GET /v1/account/me`
- `GET /v1/session/bootstrap`
- `POST /v1/onboarding/connect-shopify`
- `GET /v1/dashboard/state`
- `POST /v1/dashboard/mcp-token/create`
- `POST /v1/dashboard/mcp-token/revoke`

### License client
- `POST /v1/license/validate`
- `POST /v1/license/heartbeat`
- `POST /v1/license/deactivate`

### Admin
- `GET /v1/admin/readiness` (header: `x-admin-api-key`)
- `POST /v1/admin/license/create`
- `POST /v1/admin/license/update-status`
- `GET /v1/admin/license/:licenseKey`
- `POST /v1/admin/tenant/upsert`
- `GET /v1/admin/tenant/:tenantId`
- `POST /v1/admin/mcp/token/create`
- `POST /v1/admin/mcp/token/revoke`
- `POST /v1/admin/storage/export`

### MCP introspectie
- `POST /v1/mcp/token/introspect` (header: `x-mcp-api-key`)
- response bevat alleen minimaal noodzakelijke Shopify auth-velden voor MCP runtime (`authMode` + relevante credentials)

## Onboarding flow (gratis)
1. Open `/onboarding`.
2. Kies `Inloggen` of `Account maken`.
3. Na sessie ga je naar `/dashboard`.
4. Verbind je winkel.
5. Dashboard wordt geactiveerd met:
   - multi-store overzicht en actieve winkelselectie
   - app-cards met `Connect` acties
   - actieve app connecties met automatische klembord fallback

## Start lokaal
```bash
cd /Users/jordy/Desktop/Customer\ service/hazify-license-service
cp .env.example .env
node server.js
```

## Smoke test (live)
```bash
SHOP_DOMAIN=your-store.myshopify.com \
SHOP_ACCESS_TOKEN=shpat_... \
/Users/jordy/Desktop/Customer\ service/hazify-license-service/scripts/run-free-onboarding-smoke-test.sh
```

Scriptflow:
1. account signup (`/v1/account/signup`)
2. winkel koppelen (`/v1/onboarding/connect-shopify`) met sessie-cookie
3. MCP `initialize` + `tools/list` verificatie

## Optioneel: Stripe later activeren
Als je terug naar betaald wilt:
1. Zet `HAZIFY_FREE_MODE=false`
2. Configureer Stripe vars (`STRIPE_SECRET_KEY`, webhook secret, price IDs)
3. Gebruik billing endpoints opnieuw

## Security
- Shopify credentials blijven server-side.
- Token introspectie is backend-only (`x-mcp-api-key`).
- Accountsessies zijn HTTP-only cookies met server-side gehashte opslag.
- OAuth authorize/token vereisen PKCE met `S256` (geen `plain`).
- OAuth scope is gefixeerd op `mcp:tools`.
- Impliciete auto-recovery van onbekende OAuth clients is uitgeschakeld; alleen gecontroleerde reconnect-flow.
- HTTP body-size limiet is configureerbaar via `MAX_BODY_BYTES` (default 1MB).
- Baseline security headers zijn actief op responses.
- PostgreSQL is primair met JSON fallback voor lokale dev.
- Zonder `DATABASE_URL` in productie zijn account/OAuth-data niet persistent over redeploy/restart.
- Geef eindgebruiker alleen MCP URL + OAuth of gegenereerde MCP token.
