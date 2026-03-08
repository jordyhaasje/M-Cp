# Hazify License Service

Auth, onboarding, OAuth en token-introspectie service voor Hazify MCP.

## Start
```bash
npm run --workspace @hazify/license-service start
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

## Shopify auth modes
- `shopAccessToken`
- `shopClientId` + `shopClientSecret`

## Productievereisten
- `DATABASE_URL` verplicht
- `DATA_ENCRYPTION_KEY` verplicht

## Tests
```bash
npm run --workspace @hazify/license-service test
```
