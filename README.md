# Hazify Monorepo

Production-grade monorepo voor de Hazify license service en remote Shopify MCP service.

## Structuur
- `apps/hazify-license-service` - auth, onboarding, OAuth, token-introspectie, billing en admin operations
- `apps/hazify-mcp-remote` - remote MCP endpoint op `/mcp` (publieke route), met expliciete stdio fallback voor legacy/local gebruik
- `packages/shopify-core` - gedeelde Shopify auth/scope helpers
- `packages/mcp-common` - gedeelde MCP/HTTP utilities
- `docs` - operationele documentatie en runbooks
- `scripts` - root build/test helper scripts
- `tests` - e2e contractvalidatie
- `.github` - CI workflow

## Snel starten
```bash
npm ci
npm run build
npm test
```

## Operationele checks
```bash
# Controleer docs-index, repo-structuur en junkbestanden
npm run check:docs
npm run check:repo

# Controleer of branch veilig te pushen is (incl. dry-run)
npm run check:git-sync

# Productie smoke check (kan met defaults of custom base URLs)
npm run smoke:prod
```

## Runtime-opmerking
- `npm start` op repo-root routeert nu via `HAZIFY_SERVICE_MODE`.
- Zonder env var blijft de default `mcp`, zodat de bestaande MCP-productieroute gelijk blijft.
- Voor de license service gebruikt Railway op repo-root `HAZIFY_SERVICE_MODE=license`.
- De runtime-default van de MCP-service staat op HTTP.
- Gebruik `npm run --workspace @hazify/mcp-remote start:fallback:stdio` of `--transport=stdio` alleen voor legacy/local fallback.

## Railway link scripts
```bash
npm run railway:link:mcp
npm run railway:link:license
```

Gebruik deze scripts om repo-root snel aan het juiste Railway-project en de juiste service te koppelen.

## Cleanup guardrails
- De publieke route `https://hazify-mcp-remote-production.up.railway.app/mcp` blijft leidend.
- OAuth discovery en auth-routes blijven compatibel voor bestaande ChatGPT- en Perplexity-connecties.
- Cleanup gebeurt in slices; docs en tracker worden in dezelfde wijziging bijgewerkt.

Optionele custom endpoints voor smoke check:
- `HAZIFY_LICENSE_BASE_URL`
- `HAZIFY_MCP_BASE_URL`

## Productie endpoints
- License service: `https://hazify-license-service-production.up.railway.app`
- Remote MCP: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Leesvolgorde
Start met `docs/00-START-HERE.md` en volg daarna de aangegeven volgorde.

## Cleanup
- Actief plan: `docs/50-REPO-CLEANUP-PR-PLAN.md`
- Actieve tracker: `docs/51-REPO-CLEANUP-TRACKER.md`

## Migratie
Zie `MIGRATION.md` voor alle hernoemingen en breaking changes.
