# Tech Stack & Architectuur
Doelgroep: repo maintainers en coding agents.

## 1. Architectuur & Services
De monorepo bevat twee Node.js runtime services (vereist Node.js `>=22.12.0`):

1. **`apps/hazify-license-service`** (Entry: `src/server.js`)
   Beheert accounts (`/signup`, `/login`), onboarding (`/v1/onboarding/connect-shopify`), token-introspectie (`/v1/mcp/token/introspect`), token-exchange (`/v1/mcp/token/exchange`), OAuth server routes (`/oauth/authorize`, `/oauth/token`), en billing/admin.

2. **`apps/hazify-mcp-remote`** (Entry: `src/index.js`)
   De daadwerkelijke **Remote MCP service**. Draait op `/mcp` over Streamable HTTP. Leest, zoekt en verifieert theme files, voert de gevalideerde draft/apply pipeline uit voor theme edits, en handelt store API operaties (producten, orders, klanten) af.

Canonical shared packages staan in `packages/`. Voor Railway app-only deploys worden de runtime-kritieke packages bewust gespiegeld onder `apps/hazify-license-service/packages/` en `apps/hazify-mcp-remote/packages/`, zodat `file:` dependencies binnen de service-context resolvebaar blijven.

## 2. Deploy Platform & Env Vars
Beide services draaien in productie op Railway (`Hazify-License-Service`, `Hazify-MCP-Remote`).

### License Service (Productievereisten)
- `DATABASE_URL` en `DATA_ENCRYPTION_KEY` zijn verplicht.
- `DB_SINGLE_WRITER_ENFORCED=true` (actief als enkele writer wegens lock/persistence model).
- Rolling deploys gebruiken nu een begrensde startup-retry voor de single-writer advisory lock, zodat een nieuwe instance kort kan wachten tot de vorige writer is afgebouwd zonder de lockgarantie los te laten.
- `HAZIFY_FREE_MODE=false`.
- `ADMIN_API_KEY` en `MCP_API_KEY` (alias `HAZIFY_MCP_API_KEY`).
- `PUBLIC_BASE_URL` en `MCP_PUBLIC_URL`.
- Admin backup-export is in productie feature-gated: de service mag gewoon starten zonder backup-export-config, maar export werkt pas wanneer `BACKUP_EXPORT_KEY`, `BACKUP_EXPORT_DIRECTORY` en `BACKUP_EXPORT_POLICY=encrypted` expliciet zijn gezet.

### Remote MCP (Productievereisten)
- `DATABASE_URL` is verplicht voor guarded theme draft/apply, `theme_drafts` persistence en PostgreSQL advisory locks.
- `HAZIFY_MCP_INTROSPECTION_URL`
- `HAZIFY_MCP_API_KEY` (moet sterke secret van >=16 tekens zijn)
- `HAZIFY_MCP_PUBLIC_URL` hoort de publieke MCP base URL te bevatten. De remote gebruikt deze URL ook om de toegestane Host-header voor de MCP SDK DNS-rebinding bescherming af te leiden.
- `HAZIFY_MCP_ALLOWED_HOSTS` is optioneel voor extra domeinen of custom domains. Waarden zijn comma-separated hostnames of URLs; poorten worden genegeerd. `localhost`, `127.0.0.1`, `[::1]`, `HAZIFY_MCP_PUBLIC_URL` en Railway public domain envs worden automatisch toegevoegd.
- `HAZIFY_MCP_ALLOWED_ORIGINS` is optioneel voor browser/native-client Origin allowlisting. Gebruik dit niet als Host-header allowlist; dat is `HAZIFY_MCP_ALLOWED_HOSTS`.
- `MCP_SESSION_MODE` is standaard **`stateless`**. Stateful deployment is alleen aanbevolen met sticky sessions (`MCP_STATEFUL_DEPLOYMENT_SAFE=true`).
- `HAZIFY_MCP_CONTEXT_TTL_MS` (standaard 120.000 ms) cachet alleen de gehydrateerde requestcontext en lazy Shopify client na succesvolle introspectie; token-introspectie zelf blijft per request gebeuren.

### Shopify Admin API en custom apps
- De runtime gebruikt Shopify Admin GraphQL via `X-Shopify-Access-Token`.
- Voor merchant-created custom apps in de Shopify Admin is de Admin API access token het primaire onboardingpad.
- `shopClientId` + `shopClientSecret` blijft ondersteund voor trusted app-achtige setups, maar is niet de standaardinstructie voor merchant-created custom apps.
- Verplichte Admin API scopes volgen `REQUIRED_SHOPIFY_ADMIN_SCOPES` in `packages/shopify-core/src/index.js` en de Railway mirrors. De actuele lijst bevat onder meer `read_themes`, `write_themes`, `read_fulfillments`, `read_merchant_managed_fulfillment_orders` en `write_merchant_managed_fulfillment_orders`.
- De fulfillment tracking tools lezen `fulfillmentOrders`; Shopify vereist daarvoor expliciete fulfillment-order read scopes. Alleen write-scope is niet genoeg.

### Remote MCP observability
- De remote MCP logt request-level JSON events naar stdout; Railway is daarmee de primaire bron voor runtime-diagnose.
- `mcp_http_tool_call_finished` betekent een succesvolle tool-call.
- `mcp_http_tool_call_domain_failed` betekent dat de tool zelf gecontroleerd heeft gefaald, bijvoorbeeld door theme inspectie, `theme-check`, create/edit guardrails of read-repair blokkades.
- `mcp_http_tool_call_failed` blijft gereserveerd voor echte exceptions/protocolfouten.
- Elke request krijgt een `requestId`; dezelfde waarde gaat mee in `X-Request-Id` en in de JSON logs.
- `npm run release:status` is de operationele git-impactcheck: deze laat zien of er nog een lokale commit nodig is, of push naar `origin/main` nog openstaat en welke Railway service(s) na die push een redeploy nodig hebben.
- `scripts/check-git-sync.mjs` controleert alleen repo parity tegen `origin/main`. Railway deploy parity moet apart bevestigd worden via deploy metadata of logs.
- `npm run smoke:prod` is een post-deploy smoke check op live Railway URLs, niet een pre-deploy check.

## 3. Persistence
- Zowel de License Service als de Remote MCP draaien op PostgreSQL-backed persistence. Er is geen JSON-file opslag of runtime in-memory fallback meer buiten tests.
- Postgres writes via `createStorageAdapter` (`src/repositories/storage-adapter.js`) zijn transactioneel (upsert/delete). Geen destructieve `TRUNCATE + full reinsert`.
- Single-writer consistency is gehandhaafd door een exclusieve Postgres advisory lock; er is bewust geen ondersteuning voor meerdere parallelle write-instances tegelijk op de database.
