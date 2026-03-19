# Repo Structure
Doelgroep: repo maintainers en coding agents / Codex.

## Actieve mappen
- `apps/hazify-license-service/`
- `apps/hazify-mcp-remote/`
- `packages/shopify-core/`
- `packages/mcp-common/`
- `docs/`
- `scripts/`
- `tests/`
- `.github/`

## Archief
- `docs/archive/` voor legacy docs/artifacts
- Geen `archive/` of `templates/` meer op root
- Geen `dist/` source-of-truth in git

## Source of truth
- License service runtime code: `apps/hazify-license-service/src/`
- License service internals: `src/config/`, `src/domain/` (license/tenant/account helpers), `src/lib/`, `src/routes/` (public-ui/dashboard/account/license-billing/admin/oauth), `src/services/`, `src/repositories/`, `src/views/`
- MCP remote runtime code: `apps/hazify-mcp-remote/src/`
- `apps/hazify-mcp-remote/dist/` is build-output
- `packages/*` is de enige gedeelde code source-of-truth
- `apps/*/packages/*` hoort niet meer in de repo; `check:repo` blokkeert herintroductie

## Standaard checks
- `npm ci`
- `npm run check:docs`
- `npm run check:repo`
- `npm run build`
- `npm test`
