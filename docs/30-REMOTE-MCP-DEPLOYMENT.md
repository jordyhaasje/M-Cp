# Remote MCP Deployment (Hazify)

## Architectuur
1. `apps/hazify-license-service` beheert accounts, onboarding, OAuth en token-introspectie.
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
- `PUBLIC_BASE_URL`
- `MCP_PUBLIC_URL`

### MCP remote
- `HAZIFY_MCP_TRANSPORT=http`
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY`
- `HAZIFY_MCP_PUBLIC_URL`
- `HAZIFY_MCP_AUTH_SERVER_URL`

## Deploy checks
1. `npm run verify:shared`
2. `npm run build`
3. `npm test`
4. `npm run check:git-sync`
5. `npm run smoke:prod`
6. MCP `initialize` + `tools/list` contracttest in `tests/e2e/contract.test.mjs`
7. OAuth flow (`/oauth/register` -> `/oauth/authorize` -> `/oauth/token`)

## Smoke test script
`apps/hazify-license-service/scripts/run-free-onboarding-smoke-test.sh`

## GitHub push aandachtspunt
- Als je `.github/workflows/*` wijzigt, moet je push-auth workflow-permissie hebben.
- Bij HTTPS betekent dit meestal een PAT met `workflow` scope.
- Gebruik `npm run check:git-sync` om dit vroegtijdig te valideren.
