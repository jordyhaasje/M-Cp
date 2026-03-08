# Hazify Monorepo

Production-grade monorepo voor de Hazify license service en remote Shopify MCP service.

## Structuur
- `apps/hazify-license-service` - auth, onboarding, OAuth, token-introspectie
- `apps/hazify-mcp-remote` - remote MCP endpoint op `/mcp` (Streamable HTTP)
- `packages/shopify-core` - gedeelde Shopify auth/scope helpers
- `packages/mcp-common` - gedeelde MCP/HTTP utilities
- `docs` - operationele documentatie en runbooks
- `scripts` - root build/test helper scripts

## Snel starten
```bash
npm install
npm run build
npm test
```

## Operationele checks
```bash
# Sync en controleer app-local mirrors van packages/*
npm run sync:shared
npm run verify:shared

# Controleer of branch veilig te pushen is (incl. dry-run)
npm run check:git-sync

# Productie smoke check (kan met defaults of custom base URLs)
npm run smoke:prod
```

Optionele custom endpoints voor smoke check:
- `HAZIFY_LICENSE_BASE_URL`
- `HAZIFY_MCP_BASE_URL`

## Productie endpoints
- License service: `https://hazify-license-service-production.up.railway.app`
- Remote MCP: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Leesvolgorde
Start met `docs/00-START-HERE.md` en volg daarna de aangegeven volgorde.

## Migratie
Zie `MIGRATION.md` voor alle hernoemingen en breaking changes.
