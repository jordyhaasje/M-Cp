# Remote MCP Deployment (Hazify)

## Architectuur
1. `apps/hazify-license-service` beheert accounts, onboarding, OAuth, token-introspectie en interne token-exchange.
2. `apps/hazify-mcp-remote` serveert `/mcp` en voert tools uit binnen tenant-context.

## Productie endpoints
- License service: `https://hazify-license-service-production.up.railway.app`
- MCP endpoint: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Env vars in productie (actuele runtime)
### License service
Runtime-verplicht (afgedwongen door `apps/hazify-license-service/src/config/runtime.js`):
- `DATABASE_URL`
- `DATA_ENCRYPTION_KEY`
- `DB_SINGLE_WRITER_ENFORCED=true`
- `ADMIN_API_KEY`
- `MCP_API_KEY` (alias `HAZIFY_MCP_API_KEY` wordt ook geaccepteerd)
- `HAZIFY_FREE_MODE=false`
- `PUBLIC_BASE_URL`
- `MCP_PUBLIC_URL`

Optioneel/aanbevolen:
- `DB_SINGLE_WRITER_LOCK_KEY` (optioneel; default lock key wordt gebruikt als niet gezet)
- `MAX_BODY_BYTES` (aanbevolen minimaal `1048576`; hoger bij grotere payloads)

### MCP remote
Runtime-verplicht voor remote HTTP transport:
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY`

Runtime-guards in productie:
- `MCP_SESSION_MODE=stateful` vereist ook `MCP_STATEFUL_DEPLOYMENT_SAFE=true` (alleen gebruiken met sticky sessions of gedeelde session store)
- `HAZIFY_MCP_API_KEY` moet in productie een sterke secret zijn (minimaal 16 tekens)

Defaults/optioneel:
- `HAZIFY_MCP_TRANSPORT=http` (default)
- `MCP_SESSION_MODE=stateless` (default)
- `HAZIFY_MCP_PUBLIC_URL` (optioneel; fallback is request-based URL)
- `HAZIFY_MCP_AUTH_SERVER_URL` (optioneel; fallback is introspection base URL)
- `HAZIFY_MCP_ALLOWED_ORIGINS` (optioneel; default allowlist valt terug op request-origin)
- `HAZIFY_MCP_HTTP_HOST` / `HAZIFY_MCP_HTTP_PORT` (optioneel)
- `NIXPACKS_NODE_VERSION=22` is platform/build-config, geen runtime env var die door de Node-app wordt gelezen

### Root launcher (niet runtime-verplicht voor license service)
- `HAZIFY_SERVICE_MODE=license` is alleen relevant voor root startscript (`scripts/start-service.mjs`) dat kiest tussen `start:license` en `start:mcp`.

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
- De license service forceert een Postgres advisory lock als single-writer strategy (fail-fast als lock niet verkregen wordt).
- Consistency-garantie geldt voor exact **één actieve writer instance per database**.
- Dit model claimt expliciet geen multi-writer of horizontale write-correctness.
- De runtime gebruikt een process-memory working set als actieve state binnen die ene writer; directe externe writes naar dezelfde tabellen vallen buiten het consistency-contract.
- `pg-mem` tests valideren repository/persistence gedrag, maar niet advisory-lock semantiek; lock-semantiek vereist een echte Postgres testomgeving.

## Theme section import (extern)
De remote MCP doet geen section import. De importflow draait buiten deze repository:

`AI Client -> Chrome MCP / Shopify Dev MCP -> Theme modifications`
