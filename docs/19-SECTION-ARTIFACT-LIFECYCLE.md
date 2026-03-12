# Section Artifact Lifecycle

## Artifact record
Elke artifact gebruikt dit model:
- `artifactId` (`ins_`, `bun_`, `val_`, `imp_` + ULID)
- `tenantId`
- `type` (`inspection|bundle|validation|import`)
- `status` (`pass|fail|partial`)
- `parentIds[]`
- `payload`
- `createdAt`, `updatedAt`, `lastAccessedAt`, `expiresAt`
- `version`

## Tenant scoping
- Lookup key: `(tenantId, artifactId)`.
- Mismatch tenant => behandelen als niet gevonden.

## TTL defaults
- `inspection`: 2 uur
- `bundle`: 24 uur
- `validation`: 24 uur
- `import`: 30 dagen

## Cleanup
- L1 memory sweep: elke 10 minuten.
- L2 purge: elke 60 minuten + startup best effort.
- Lazy purge bij `get` van verlopen artifact.
- L1 tenant-cap: standaard 200 artifacts (LRU-ish op `lastAccessedAt`).

## Storage layers
- L1: `MemoryArtifactStore`
- L2: `PersistentArtifactStore` (license-service)
- Orchestratie: `HybridArtifactStore`

## Quota safeguards
- L1: per-tenant cap via `HAZIFY_SECTION_ARTIFACT_MAX_PER_TENANT`.
- L2: per-tenant cap via license-service `HAZIFY_MCP_ARTIFACTS_MAX_PER_TENANT` (default 2000).
- Bij overschrijding retourneert persistence API `error=artifact_quota_exceeded`.

## Internal persistence API
- `POST /v1/mcp/artifacts/upsert`
- `POST /v1/mcp/artifacts/get`
- `POST /v1/mcp/artifacts/delete`
- `POST /v1/mcp/artifacts/purge-expired`

Alle endpoints vereisen `x-mcp-api-key`.
