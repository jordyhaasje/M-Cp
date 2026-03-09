# Remote MCP Deployment (Hazify)

## Architectuur
1. `apps/hazify-license-service` beheert accounts, onboarding, OAuth en token-introspectie.
2. `apps/hazify-mcp-remote` serveert `/mcp` en voert tools uit binnen tenant-context.

## Section replication hosting strategy
- Productie blijft op 1 publieke MCP service (`hazify-mcp-remote`).
- Geen extra customer-facing Railway services voor Chrome DevTools MCP of Shopify Dev MCP.
- Eventuele browser/validatie tooling alleen intern/dev gebruiken.
- Publieke section-tooling bestaat uit 1 endpoint: `replicate-section-from-reference` (v3 autopipeline met strict visual gate).

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
- `PLAYWRIGHT_BROWSERS_PATH=0`
- `HAZIFY_SECTION_V3_REFERENCE_TIMEOUT_MS` (optioneel)
- `HAZIFY_SECTION_V3_BROWSER_TIMEOUT_MS` (optioneel)
- `HAZIFY_SECTION_V3_PIXEL_THRESHOLD` (optioneel)
- `HAZIFY_PLAYWRIGHT_INSTALL` (optioneel, default aan)
- `HAZIFY_PLAYWRIGHT_INSTALL_STRICT` (optioneel, default aan in CI/Railway)

## Deploy checks
1. `npm run verify:shared`
2. `npm run build`
3. `npm test`
4. Bevestig in buildlogs dat `postinstall` Playwright Chromium installeert (geen ontbrekende executable errors)
5. `npm run check:git-sync`
6. `npm run smoke:prod`
7. MCP `initialize` + `tools/list` contracttest in `tests/e2e/contract.test.mjs`
8. OAuth flow (`/oauth/register` -> `/oauth/authorize` -> `/oauth/token`)

## Smoke test script
`apps/hazify-license-service/scripts/run-free-onboarding-smoke-test.sh`

## GitHub push aandachtspunt
- Als je `.github/workflows/*` wijzigt, moet je push-auth workflow-permissie hebben.
- Bij HTTPS betekent dit meestal een PAT met `workflow` scope.
- Gebruik `npm run check:git-sync` om dit vroegtijdig te valideren.
