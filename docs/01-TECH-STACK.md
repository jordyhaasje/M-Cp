# Tech Stack & Architectuur
Doelgroep: repo maintainers en coding agents.

## 1. Architectuur & Services
De monorepo bevat twee Node.js runtime services (vereist Node.js `>=22.12.0`):

1. **`apps/hazify-license-service`** (Entry: `src/server.js`)
   Beheert accounts (`/signup`, `/login`), onboarding (`/v1/onboarding/connect-shopify`), token-introspectie (`/v1/mcp/token/introspect`), token-exchange (`/v1/mcp/token/exchange`), OAuth server routes (`/oauth/authorize`, `/oauth/token`), en billing/admin.

2. **`apps/hazify-mcp-remote`** (Entry: `src/index.js`)
   De daadwerkelijke **Remote MCP service**. Draait op `/mcp` over Streamable HTTP. Leest, zoekt en verifieert theme files, voert de gevalideerde draft/apply pipeline uit voor theme edits, en handelt store API operaties (producten, orders, klanten) af.

## 2. Deploy Platform & Env Vars
Beide services draaien in productie op Railway (`Hazify-License-Service`, `Hazify-MCP-Remote`).

### License Service (Productievereisten)
- `DATABASE_URL` en `DATA_ENCRYPTION_KEY` zijn verplicht.
- `DB_SINGLE_WRITER_ENFORCED=true` (actief als enkele writer wegens lock/persistence model).
- `HAZIFY_FREE_MODE=false`.
- `ADMIN_API_KEY` en `MCP_API_KEY` (alias `HAZIFY_MCP_API_KEY`).
- `PUBLIC_BASE_URL` en `MCP_PUBLIC_URL`.

### Remote MCP (Productievereisten)
- `DATABASE_URL` is verplicht voor guarded theme draft/apply, `theme_drafts` persistence en PostgreSQL advisory locks.
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY` (moet sterke secret van >=16 tekens zijn)
- `MCP_SESSION_MODE` is standaard **`stateless`**. Stateful deployment is alleen aanbevolen met sticky sessions (`MCP_STATEFUL_DEPLOYMENT_SAFE=true`).
- In-memory context cache `HAZIFY_MCP_CONTEXT_TTL_MS` (standaard 120.000 ms over HTTP).

## 3. Persistence
- Zowel de License Service als de Remote MCP draaien op PostgreSQL-backed persistence. Er is geen JSON-file opslag of runtime in-memory fallback meer buiten tests.
- Postgres writes via `createStorageAdapter` (`src/repositories/storage-adapter.js`) zijn transactioneel (upsert/delete). Geen destructieve `TRUNCATE + full reinsert`.
- Single-writer consistency is gehandhaafd door een exclusieve Postgres advisory lock; er is bewust geen ondersteuning voor meerdere parallelle write-instances tegelijk op de database.
