# Hazify License Service

Auth, onboarding, OAuth, token-introspectie, billing en admin operations voor Hazify MCP.

## Start
```bash
npm run --workspace @hazify/license-service start
```

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
- `POST /oauth/register`
- `GET|POST /oauth/authorize`
- `POST /oauth/token`
- `GET /v1/billing/readiness`
- `POST /v1/billing/create-checkout-session`
- `POST /v1/billing/create-portal-session`
- `POST /v1/stripe/webhook`
- `GET /v1/admin/readiness`
- `POST /v1/admin/storage/export`

## Shopify auth modes
- `shopAccessToken`
- `shopClientId` + `shopClientSecret`

## Productievereisten
- `DATABASE_URL` verplicht
- `DATA_ENCRYPTION_KEY` verplicht
- Stripe-variabelen zijn nodig wanneer billing actief moet zijn

## Interne structuur
- `src/server.js` - HTTP entrypoint, shared helpers en route-registratie
- `src/config/` - runtime-config en env-validatie
- `src/domain/` - license-, tenant- en accounthelpers
- `src/lib/` - pure helpers voor tijd, OAuth, cookies en protocolgedrag
- `src/routes/` - routeclusters voor `public-ui`, `dashboard`, `account`, `license-billing`, `admin` en `oauth`
- `src/services/` - billing/readiness helpers en account-sessies
- `src/repositories/` - opslaglaag (JSON/Postgres adapter)
- `src/views/` - dashboard, login en onboarding HTML renderers

## Tests
```bash
npm run --workspace @hazify/license-service test
```
