# MIGRATION

## Samenvatting
Deze migratie zet de repository om naar een remote-first npm-workspaces monorepo met `src/` als source-of-truth.

## Hernoemde/verplaatste mappen
- `hazify-license-service` -> `apps/hazify-license-service`
- `shopify-mcp-local` -> `apps/hazify-mcp-remote`
- nieuwe gedeelde packages:
  - `packages/shopify-core`
  - `packages/mcp-common`
- root `archive/` -> `docs/archive/artifacts/root-archive`
- root `templates/mcp-server-template` -> `docs/archive/templates/mcp-server-template`

## Build/source wijziging
- `apps/hazify-mcp-remote/src/` is nu source-of-truth.
- `apps/hazify-mcp-remote/dist/` is build-output via:
  - `npm run --workspace @hazify/mcp-remote build`

## Package/workspace wijzigingen
- Root `package.json` met npm workspaces toegevoegd.
- Nieuwe workspace package names:
  - `@hazify/license-service`
  - `@hazify/mcp-remote`
  - `@hazify/shopify-core`
  - `@hazify/mcp-common`
- `@modelcontextprotocol/sdk` geüpgraded naar `^1.26.0`.
- App-local mirror packages (`apps/*/packages/*`) worden beheerd via:
  - `npm run sync:shared`
  - `npm run verify:shared`
  Dit voorkomt drift tussen runtime deploy-context en root shared packages.

## Security/validatie wijzigingen
- Onboarding scope-validatie vereist nu expliciet:
  - `read_themes`
  - `write_themes`
- In productie zijn nu verplicht:
  - `DATABASE_URL`
  - `DATA_ENCRYPTION_KEY`

## Backward compatibility
Behouden:
- publieke routes en API-contracten van license service en MCP `/mcp`
- OAuth metadata/routes en fallback aliases (`/register`, `/authorize`, `/token`)
- beide Shopify authvormen:
  - `shopAccessToken`
  - `shopClientId` + `shopClientSecret`

Bewuste wijzigingen:
- repository paden zijn gewijzigd (apps/packages structuur)
- `dist/` is niet langer handmatig te bewerken broncode
- productie-start van license service faalt direct zonder verplichte DB/env encryptie

## Nieuwe root-commando's
```bash
npm install
npm run build
npm test
```
