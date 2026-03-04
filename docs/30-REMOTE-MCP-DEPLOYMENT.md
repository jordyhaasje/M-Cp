# Remote MCP Deployment (Hazify)

## Doel
Productie deployment van `hazify-mcp` met:
- centrale tenant-opslag van Shopify credentials
- token-introspectie naar MCP service
- self-service onboarding voor eindgebruikers
- gratis onboarding flow als standaard

## Live productie (4 maart 2026)
- License service: `https://hazify-license-service-production.up.railway.app`
- MCP endpoint: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Architectuur
1. `shopify-mcp-local/` draait als remote HTTP MCP service.
2. `hazify-license-service/` beheert:
   - licenses
   - tenant Shopify credentials
   - MCP token issuance/revocation
   - MCP token introspectie
   - OAuth authorization server (register/authorize/token)

## Basisvariabelen (verplicht)
### License service
- `HAZIFY_FREE_MODE=true`
- `ADMIN_API_KEY`
- `MCP_API_KEY`
- `PUBLIC_BASE_URL`
- `MCP_PUBLIC_URL`
- `DATABASE_URL` (verplicht voor persistente accounts/OAuth in productie)
- `PORT`

### Remote MCP service
- `HAZIFY_MCP_TRANSPORT=http`
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY`
- `HAZIFY_MCP_PUBLIC_URL` (aanbevolen)
- `HAZIFY_MCP_AUTH_SERVER_URL` (aanbevolen)
- `PORT`

### License service (OAuth)
- `OAUTH_ISSUER` (optioneel)
- `OAUTH_ACCESS_TOKEN_TTL_SECONDS` (optioneel)
- `OAUTH_REFRESH_TOKEN_TTL_DAYS` (optioneel)
- `OAUTH_CODE_TTL_MINUTES` (optioneel)

## Readiness-check
- `GET /v1/billing/readiness`

Verwacht in gratis modus:
- `mode: "free"`
- `freeMode: true`
- `readyForOnboarding: true`
- `readyForManagedCheckout: false`
- `readyForPaymentLinks: false`

## Smoke test (gratis flow)
Script:
- `/Users/jordy/Desktop/Customer service/hazify-license-service/scripts/run-free-onboarding-smoke-test.sh`

Voorbeeld:
```bash
SHOP_DOMAIN=your-store.myshopify.com \
SHOP_ACCESS_TOKEN=shpat_... \
/Users/jordy/Desktop/Customer\ service/hazify-license-service/scripts/run-free-onboarding-smoke-test.sh
```

## Security
- Alleen backend-naar-backend introspectie met `x-mcp-api-key`.
- Shopify credentials blijven server-side.
- Eindgebruiker krijgt alleen MCP URL + token.
- Zonder `DATABASE_URL` valt storage terug op JSON en kunnen account/OAuth registraties bij redeploy verloren gaan.

## Optioneel: Stripe later activeren
Standaard staat billing uit door `HAZIFY_FREE_MODE=true`.
Wil je later betaald aanbieden, zet dan `HAZIFY_FREE_MODE=false` en configureer:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_DEFAULT_PRICE_ID` of plan-specifieke price IDs
- success/cancel/portal URLs
