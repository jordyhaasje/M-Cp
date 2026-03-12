# Section Orchestration Architecture

## Scope
Deze architectuur implementeert staged section orchestration op `main` met één publieke MCP (Hazify) en interne adapters.

## Kernprincipes
1. Hazify MCP blijft de enige publieke/orchestrator surface.
2. Chrome/browser inspectie is een interne capability via adapter (`chrome-mcp`).
3. Shopify Dev validatie is een interne capability via adapter (`shopify-dev-mcp`).
4. Adapter-bridge transport in v1 is stdio subprocess-only (HTTP bridge runtime-disabled).
5. Theme import blijft in Hazify via Shopify Admin APIs.
6. Artifact lifecycle is tenant-scoped met hybrid storage (memory + persistent).

## Module-overzicht
- `apps/hazify-mcp-remote/src/section-workflow/contracts.js`
- `apps/hazify-mcp-remote/src/section-workflow/error-model.js`
- `apps/hazify-mcp-remote/src/section-workflow/artifacts/*`
- `apps/hazify-mcp-remote/src/section-workflow/adapters/*`
- `apps/hazify-mcp-remote/src/section-workflow/stages/*`
- `apps/hazify-mcp-remote/src/section-workflow/orchestrator.js`
- `apps/hazify-mcp-remote/src/tools/*section*`

## Storage architectuur
- L1: `MemoryArtifactStore` per proces.
- L2: `PersistentArtifactStore` via license-service interne API.
- Hybrid: `HybridArtifactStore` combineert read-through en best-effort write-through.

## License-service uitbreiding
- `apps/hazify-license-service/src/domain/mcp-artifacts.js`
- `apps/hazify-license-service/src/routes/mcp-artifacts.js`
- endpoints:
  - `POST /v1/mcp/artifacts/upsert`
  - `POST /v1/mcp/artifacts/get`
  - `POST /v1/mcp/artifacts/delete`
  - `POST /v1/mcp/artifacts/purge-expired`

## Tooling surface
- Staged tools:
  - `inspect-reference-section`
  - `generate-shopify-section-bundle`
  - `validate-shopify-section-bundle`
  - `import-shopify-section-bundle`
- Compat:
  - `replicate-section-from-reference`

## Theme-targeting
1. `themeId` als expliciete target.
2. Anders `themeRole`.
3. Anders live theme fallback (`main`).
