# Tech Stack & Architectuur
Doelgroep: repo maintainers en coding agents.

## 1. Architectuur & Services
De monorepo bevat drie Node.js runtime services (vereist Node.js `>=22.12.0`):

1. **`apps/hazify-license-service`** (Entry: `src/server.js`)
   Beheert accounts (`/signup`, `/login`), onboarding (`/v1/onboarding/connect-shopify`), token-introspectie (`/v1/mcp/token/introspect`), token-exchange (`/v1/mcp/token/exchange`), OAuth server routes (`/oauth/authorize`, `/oauth/token`), en billing/admin.

2. **`apps/hazify-mcp-remote`** (Entry: `src/index.js`)
   De daadwerkelijke **Remote MCP service**. Draait op `/mcp` over HTTP transport. Voert guarded preview/apply van theme files uit en handelt store API operaties (producten, orders, klanten) af.

3. **`apps/hazify-visual-worker`** (Entry: `src/server.js`)
   Optionele verrijkingsservice voor reference-analyse. Draait buiten de hoofd-MCP en levert rijkere `referenceSpec` output voor moeilijke section-cloning cases.

## 2. Deploy Platform & Env Vars
Beide services draaien in productie op Railway (`Hazify-License-Service`, `Hazify-MCP-Remote`). 

### License Service (Productievereisten)
- `DATABASE_URL` en `DATA_ENCRYPTION_KEY` zijn verplicht.
- `DB_SINGLE_WRITER_ENFORCED=true` (actief als enkele writer wegens lock/persistence model).
- `HAZIFY_FREE_MODE=false`.
- `ADMIN_API_KEY` en `MCP_API_KEY` (alias `HAZIFY_MCP_API_KEY`).
- `PUBLIC_BASE_URL` en `MCP_PUBLIC_URL`.

### Remote MCP (Productievereisten)
- `DATABASE_URL` is verplicht zodra je guarded theme draft/apply en PostgreSQL advisory locks in productie gebruikt.
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY` (moet sterke secret van >=16 tekens zijn)
- `MCP_SESSION_MODE` is standaard **`stateless`**. Stateful deployment is alleen aanbevolen met sticky sessions (`MCP_STATEFUL_DEPLOYMENT_SAFE=true`).
- In-memory context cache `HAZIFY_MCP_CONTEXT_TTL_MS` (standaard 120.000 ms over HTTP).
- `HAZIFY_VISUAL_ANALYSIS_ENABLED` activeert gefaseerd URL-based visual enrichment. De fallback naar Cheerio moet altijd bruikbaar blijven.
- `HAZIFY_VISUAL_WORKER_URL` voor hybrid reference analysis wanneer de feature flag actief is.
- `HAZIFY_VISUAL_ANALYSIS_TIMEOUT_MS` voor externe analyse-tijdslimieten.
- Alleen buiten productie mag de remote nog terugvallen op in-memory theme draft opslag.

### Visual Worker (Productievereisten)
- `PORT` of `HAZIFY_VISUAL_WORKER_PORT`
- Optioneel `HAZIFY_VISUAL_ANALYSIS_TIMEOUT_MS`
- De service gebruikt dezelfde HTTPS/SSRF-guardrails als de reference-analyse in de MCP remote.

## 3. Persistence
- Postgres writes via `createStorageAdapter` (`src/repositories/storage-adapter.js`) zijn transactioneel (upsert/delete). Geen destructieve `TRUNCATE + full reinsert`.
- Single-writer consistency is gehandhaafd door een exclusieve Postgres advisory lock; er is bewust geen ondersteuning voor meerdere parallelle write-instances tegelijk op de database.
