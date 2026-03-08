# Repo Structure

## Actieve mappen
- `apps/hazify-license-service/`
- `apps/hazify-mcp-remote/`
- `packages/shopify-core/`
- `packages/mcp-common/`
- `docs/`
- `scripts/`

## Archief
- `docs/archive/` voor legacy docs/artifacts
- Geen `archive/` of `templates/` meer op root
- Geen `dist/` source-of-truth in git

## Source of truth
- License service runtime code: `apps/hazify-license-service/src/`
- MCP remote runtime code: `apps/hazify-mcp-remote/src/`
- `apps/hazify-mcp-remote/dist/` is build-output

## Standaard checks
- `npm install`
- `npm run build`
- `npm test`
