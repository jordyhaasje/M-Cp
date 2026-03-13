# Remote MCP Deployment (Hazify)

## Architectuur
1. `apps/hazify-license-service` beheert accounts, onboarding, OAuth, token-introspectie en interne token-exchange.
2. `apps/hazify-mcp-remote` serveert `/mcp` en voert tools uit binnen tenant-context.

## Productie endpoints
- License service: `https://hazify-license-service-production.up.railway.app`
- MCP endpoint: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Verplichte env vars in productie
### License service
- `DATABASE_URL`
- `DATA_ENCRYPTION_KEY`
- `ADMIN_API_KEY`
- `MCP_API_KEY`
- `HAZIFY_FREE_MODE=false`
- `MAX_BODY_BYTES` (aanbevolen minimaal `1048576`; hoger bij grotere artifact payloads)
- `HAZIFY_MCP_ARTIFACTS_MAX_PER_TENANT` (L2 artifact quota, default 2000)
- `PUBLIC_BASE_URL`
- `MCP_PUBLIC_URL`
- `HAZIFY_SERVICE_MODE=license`

### MCP remote
- `HAZIFY_MCP_TRANSPORT=http`
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY`
- `HAZIFY_MCP_PUBLIC_URL`
- `HAZIFY_MCP_AUTH_SERVER_URL`
- `MCP_SESSION_MODE=stateless` (default)
- `MCP_STATEFUL_DEPLOYMENT_SAFE=true` alleen als `MCP_SESSION_MODE=stateful` met sticky sessions/gedeelde session store
- `NIXPACKS_NODE_VERSION=22` (of hoger; `>=22.12.0` vereist)

## Deploy checks
1. `npm run check:docs`
2. `npm run check:repo`
3. `npm run build`
4. `npm test`
5. `npm run smoke:prod`
6. MCP `initialize` + `tools/list` contracttest in `tests/e2e/contract.test.mjs`
7. OAuth flow (`/oauth/register` -> `/oauth/authorize` -> `/oauth/token`)

## Session behavior
- Standaard draait `/mcp` in stateless mode zonder `mcp-session-id`.
- Stateful mode is optioneel en vereist expliciete deploymentgaranties:
  - sticky sessions op load balancer, of
  - gedeelde session store.
- Gebruik stateful mode niet in productie zonder deze garanties.

## Persistence behavior (license service)
- Postgres writes zijn transactioneel en per-entity (upsert/delete), zonder destructive `TRUNCATE + full reinsert`.
- De applicatie houdt een in-memory werkset bij; voor maximale write-consistentie wordt momenteel een single-writer deployment voor de license service aanbevolen.

## Theme section import (extern)
De remote MCP doet geen section import. De importflow draait buiten deze repository:

`AI Client -> Chrome MCP / Shopify Dev MCP -> Theme modifications`
