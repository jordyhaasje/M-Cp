# Remote MCP Deployment (Hazify)

## Architectuur
1. `apps/hazify-license-service` beheert accounts, onboarding, OAuth en token-introspectie.
2. `apps/hazify-mcp-remote` serveert `/mcp` en voert tools uit binnen tenant-context.

## Huidige deploystatus
- De live MCP Railway deployment draait sinds 2026-03-10 succesvol vanaf repo-root.
- Root `npm start` routeert nu via `HAZIFY_SERVICE_MODE`.
- `Hazify-MCP-Remote` gebruikt repo-root met de default `HAZIFY_SERVICE_MODE=mcp`.
- `Hazify-License-Service` kan daardoor ook vanaf repo-root draaien met `HAZIFY_SERVICE_MODE=license`.
- De repo-root topologie is gevalideerd in Railway environment `cleanup-root-deploy` en daarna succesvol naar productie gemigreerd.
- App-local package mirrors zijn daardoor geen onderdeel meer van het actieve deploy-contract.
- De huidige MCP productieversie draait op deployment `9225c0ab-98d4-472a-a754-8684e7569b3a`.
- De huidige license productieversie draait op deployment `85d9c4f7-eb9d-4761-a29c-44b60483edb2`.

## Repo-root Railway beheer
- `npm run railway:link:mcp` koppelt repo-root aan project/service `Hazify-MCP-Remote`.
- `npm run railway:link:license` koppelt repo-root aan project/service `Hazify-License-Service`.
- De bestaande MCP-link blijft leidend voor publieke `/mcp` deploys; wissel alleen expliciet als je de license service wilt beheren of uitrollen.

## Section replication hosting strategy
- Productie blijft op 1 publieke MCP service (`hazify-mcp-remote`).
- Geen extra customer-facing Railway services voor Chrome DevTools MCP of Shopify Dev MCP.
- Eventuele browser/validatie tooling alleen intern/dev gebruiken.
- Publieke section-tooling gebruikt staged orchestration tools plus compat wrapper:
  - `inspect-reference-section`
  - `generate-shopify-section-bundle`
  - `validate-shopify-section-bundle`
  - `import-shopify-section-bundle`
  - `replicate-section-from-reference` (compat)

## Productie endpoints
- License service: `https://hazify-license-service-production.up.railway.app`
- MCP endpoint: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Verplichte env vars in productie
### License service
- `DATABASE_URL`
- `DATA_ENCRYPTION_KEY`
- `ADMIN_API_KEY`
- `MCP_API_KEY`
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
- `PLAYWRIGHT_BROWSERS_PATH=0`
- `NIXPACKS_NODE_VERSION=22` (of hoger; `>=22.12.0` vereist)
- `RAILPACK_DEPLOY_APT_PACKAGES` (vereist voor Chromium runtime libs)
- `HAZIFY_SECTION_ARTIFACT_MODE` (`hybrid` aanbevolen)
- `HAZIFY_SECTION_ARTIFACT_MAX_PER_TENANT`
- `HAZIFY_SECTION_ARTIFACT_SWEEP_INTERVAL_MS`
- `HAZIFY_SECTION_ARTIFACT_PURGE_INTERVAL_MS`
- `HAZIFY_SECTION_ARTIFACT_PERSIST_URL` (license-service base URL)
- `HAZIFY_SECTION_ARTIFACT_PERSIST_API_KEY` (`x-mcp-api-key`)
- `HAZIFY_SECTION_ARTIFACT_PERSIST_TIMEOUT_MS`
- `HAZIFY_SECTION_ARTIFACT_TTL_INSPECTION_MS`
- `HAZIFY_SECTION_ARTIFACT_TTL_BUNDLE_MS`
- `HAZIFY_SECTION_ARTIFACT_TTL_VALIDATION_MS`
- `HAZIFY_SECTION_ARTIFACT_TTL_IMPORT_MS`
- `HAZIFY_SECTION_CHROME_MCP_STDIO_COMMAND` (verplicht voor staged browser-bridge; aanbevolen `node`)
- `HAZIFY_SECTION_CHROME_MCP_STDIO_ARGS` (aanbevolen `["apps/hazify-mcp-remote/scripts/section-providers/chrome-provider-bridge.mjs"]`)
- `HAZIFY_SECTION_CHROME_MCP_STDIO_CWD` (optioneel)
- `HAZIFY_SECTION_SHOPIFY_DEV_MCP_STDIO_COMMAND` (verplicht voor staged validator-bridge; aanbevolen `node`)
- `HAZIFY_SECTION_SHOPIFY_DEV_MCP_STDIO_ARGS` (aanbevolen `["apps/hazify-mcp-remote/scripts/section-providers/shopify-dev-provider-bridge.mjs"]`)
- `HAZIFY_SECTION_SHOPIFY_DEV_MCP_STDIO_CWD` (optioneel)
- `HAZIFY_SECTION_PROVIDER_TIMEOUT_MS` (optioneel; default `45000`)
- `HAZIFY_SECTION_CHROME_UPSTREAM_COMMAND` (aanbevolen `npx`)
- `HAZIFY_SECTION_CHROME_UPSTREAM_ARGS` (aanbevolen `["-y","chrome-devtools-mcp","--headless","--isolated","--no-usage-statistics","--chromeArg=--no-sandbox","--chromeArg=--disable-setuid-sandbox"]`)
- `HAZIFY_SECTION_CHROME_UPSTREAM_CWD` (optioneel)
- `HAZIFY_SECTION_CHROME_EXECUTABLE_PATH` (optioneel expliciet pad; als leeg gebruikt bridge automatisch Playwright Chromium executable)
- `HAZIFY_SECTION_SHOPIFY_DEV_UPSTREAM_COMMAND` (aanbevolen `npx`)
- `HAZIFY_SECTION_SHOPIFY_DEV_UPSTREAM_ARGS` (aanbevolen `["-y","@shopify/dev-mcp"]`)
- `HAZIFY_SECTION_SHOPIFY_DEV_UPSTREAM_CWD` (optioneel)
- `HAZIFY_SECTION_SHOPIFY_DEV_API` (aanbevolen `liquid`)
- HTTP bridge vars mogen blijven bestaan voor toekomstige support, maar worden in v1 runtime geweigerd.
- `HAZIFY_SECTION_COMPAT_MODE` (`staged` aanbevolen)
- `HAZIFY_PLAYWRIGHT_INSTALL` (optioneel, default aan)
- `HAZIFY_PLAYWRIGHT_INSTALL_STRICT` (optioneel, default aan in CI/Railway)

## Deploy checks
1. `npm run check:docs`
2. `npm run check:repo`
3. `npm run build`
4. `npm test`
5. Bevestig in buildlogs dat `postinstall` Playwright Chromium installeert (geen ontbrekende executable errors)
6. Bevestig in buildlogs dat runtime apt deps worden geïnstalleerd via `RAILPACK_DEPLOY_APT_PACKAGES`
7. `npm run check:git-sync`
8. `npm run smoke:prod`
9. MCP `initialize` + `tools/list` contracttest in `tests/e2e/contract.test.mjs`
10. OAuth flow (`/oauth/register` -> `/oauth/authorize` -> `/oauth/token`)

## Laatste bevestigde rollout
- 2026-03-10: deployment `b0f497e2-0fb8-45bf-aebd-3322820661fa` zette productie over op repo-root.
- 2026-03-10: deployment `e19eba1c-efc9-4cae-b2b5-541cc8b572eb` verwijderde de gedeelde app-local package mirrors uit de actieve productiebuild.
- 2026-03-10: `npm run smoke:prod` slaagde na de mirrorvrije rollout.
- 2026-03-10: deployment `c99ffcaf-9474-4ee6-98c5-f962ab8a6051` rolde de nieuwste MCP cleanup door (HTTP default, GraphQL checksum-writes, expliciete section blueprint-catalogus).
- 2026-03-10: `npm run smoke:prod` slaagde na deployment `c99ffcaf-9474-4ee6-98c5-f962ab8a6051`.
- 2026-03-10: deployment `cc78a46e-623a-417e-b26f-b1c4a004ffcf` rolde Fase 6/7 door (inline section assets, theme-context storefront rendercheck met rollback, verwijderde license compat-shim in repo).
- 2026-03-10: `npm run smoke:prod` slaagde na deployment `cc78a46e-623a-417e-b26f-b1c4a004ffcf`.
- 2026-03-10: repo-root startrouter toegevoegd via `HAZIFY_SERVICE_MODE`, plus expliciete Railway-linkscripts voor MCP en license service.
- 2026-03-10: deployment `85d9c4f7-eb9d-4761-a29c-44b60483edb2` valideerde `Hazify-License-Service` vanaf repo-root met `HAZIFY_SERVICE_MODE=license`.
- 2026-03-10: deployment `9225c0ab-98d4-472a-a754-8684e7569b3a` bevestigde daarna opnieuw `Hazify-MCP-Remote` vanaf repo-root met de default `HAZIFY_SERVICE_MODE=mcp`.
- 2026-03-10: `npm run smoke:prod` slaagde na beide repo-root deployvalidaties.

## Smoke test script
`apps/hazify-license-service/scripts/run-free-onboarding-smoke-test.sh`

## GitHub push aandachtspunt
- Als je `.github/workflows/*` wijzigt, moet je push-auth workflow-permissie hebben.
- Bij HTTPS betekent dit meestal een PAT met `workflow` scope.
- Gebruik `npm run check:git-sync` om dit vroegtijdig te valideren.
