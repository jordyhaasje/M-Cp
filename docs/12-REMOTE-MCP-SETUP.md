# Remote MCP Setup (Aanbevolen)
Doelgroep: ChatGPT / connector integraties, coding agents / Codex en repo maintainers.

## Doel
Eindgebruikers verbinden via remote MCP zonder lokale server setup.

- MCP URL: `https://hazify-mcp-remote-production.up.railway.app/mcp`
- License service: `https://hazify-license-service-production.up.railway.app`

## Onboarding flow
1. Open `/onboarding`
2. Login of signup
3. Connect Shopify store met:
   - `shopAccessToken`, of
   - `shopClientId` + `shopClientSecret`
4. Credentials en scopes worden live gevalideerd
5. Maak MCP token of gebruik OAuth connect flow

## Vereiste Shopify scopes
```text
read_products,write_products,read_customers,write_customers,read_orders,write_orders,read_fulfillments,read_inventory,write_merchant_managed_fulfillment_orders,read_themes,write_themes
```

## Authenticatie
### OAuth (voorkeur)
- discovery via `/.well-known/oauth-protected-resource`
- compatibele discovery-aliases bestaan ook voor issuer-URL's met padcomponenten, inclusief path-inserted well-known routes voor hosts die de nieuwste MCP-discovery verwachten
- authorize/token met PKCE `S256`
- `GET /oauth/authorize` rendert alleen de toestemmingpagina; allow/deny gebeurt via `POST /oauth/authorize`
- De authorize submit bewaart de volledige originele OAuth-context, inclusief `resource`; bodyvelden winnen, querystring dient alleen als continuity fallback
- Als body en query conflicteren op gevoelige velden (`client_id`, `redirect_uri`, `state`, `response_type`, `code_challenge*`, `scope`, `resource`) weigert de server de request met `invalid_request`
- Interactieve OAuth-routes nemen de `redirect_uri`-origin op in CSP `form-action`, zodat connector returns naar `https://chatgpt.com` of andere geregistreerde HTTPS callbacks niet door de browser worden geblokkeerd
- Dynamic client registration zonder `token_endpoint_auth_method` valt terug op public client (`none`)
- Legacy DCR-clients die eerder foutief als `client_secret_*` zijn opgeslagen, mogen zonder secret verder voor native/public redirect URI's (loopback/custom scheme) om VS Code/Codex reconnects compatibel te houden.
- Legacy public/native clients met `token_endpoint_auth_method=none` mogen tijdens token/refresh ook een meegezonden `client_secret` hebben; de server negeert die secret en valideert op `client_id` + PKCE.
- compat-first scopes:
  - `mcp:tools` blijft legacy full access
  - `mcp:tools:read` geeft read-only tooltoegang
  - `mcp:tools:write` geeft full access en is vereist voor muterende tools
- `resource` wordt compat-first verwerkt:
  - als de client `resource` meestuurt, moet die exact overeenkomen met de remote MCP URL van deze authorization server
  - legacy token-requests zonder `resource` blijven ondersteund om reconnect-regressies te voorkomen
- server-side tokenvalidatie via `/v1/mcp/token/introspect`
- interne Shopify token-exchange via `/v1/mcp/token/exchange` gebeurt lazy:
  - geen exchange bij `initialize` of `tools/list`
  - geen exchange bij context-free tools
  - exchange pas bij tools die Shopify-auth echt nodig hebben
- `/v1/mcp/token/exchange` volgt license read-policy vóór token-return (403 `license_inactive` bij denied)
- muterende tools geven server-side `403 insufficient_scope` zonder `mcp:tools:write`
- tool annotations blijven hints; autorisatie blijft server-side scope plus licentiebeleid
- Voor native/desktop clients met opaque origin (bijv. `vscode-webview://...`): voeg `null` toe aan `HAZIFY_MCP_ALLOWED_ORIGINS`.
- De server normaliseert `Accept` voor `POST /mcp` compatibel (bijv. `application/json` of `*/*`), zodat clients die geen expliciete `text/event-stream` sturen nog steeds kunnen initialiseren.

### API token (fallback)
Gebruik alleen als OAuth niet beschikbaar is in de client.

## Client-compatibiliteit
- Minimale host-ondersteuning: `initialize`, `tools/list`, Bearer-auth op `/mcp`, OAuth PKCE `S256` of handmatige API-tokenconfiguratie.
- Client-support verschilt nog per host; sommige clients volgen protected resource metadata volledig, andere vereisen handmatige invulling van auth- of MCP-URL's.
- Dynamic client registration blijft beschikbaar voor backwards compatibility, maar handmatige preregistratie of vaste clientconfig kan nog steeds nodig zijn bij hosts met beperkte OAuth-discovery.
- Als een host geen remote OAuth-flow ondersteunt, blijft de API-token fallback bruikbaar.

## Snelle validatie
1. `initialize` werkt
2. `tools/list` werkt
3. token revoke -> nieuwe request faalt
4. disallowed origin -> request faalt
5. stateless mode (`MCP_SESSION_MODE=stateless`) werkt zonder `mcp-session-id`

## Theme import policy
- Hazify MCP ondersteunt native OS 2.0 section-create/place via `create-theme-section` voor:
  - `templates/*.json`
  - `sections/header-group.json`
  - `sections/footer-group.json`
- Hazify MCP ondersteunt daarnaast remote theme file planning, deploy en verificatie:
  - goedkope planningslaag:
    - `resolve-template-sections`
    - `find-theme-section-by-name`
    - `search-theme-files`
  - create helper:
    - `create-theme-section`
  - single-file: `get-theme-file`, `upsert-theme-file`, `delete-theme-file`
  - batch v2: `get-theme-files`, `upsert-theme-files`, `verify-theme-files`
- Start bij normale theme-fixes niet met generieke tool-discovery; gebruik direct deze Hazify theme tools.
- `get-theme-files` blijft metadata-first; `get-theme-file` is nu ook metadata-first tenzij `includeContent=true` expliciet wordt gezet.
- Gebruik bij edits op bestaande theme files bij voorkeur de `checksum` uit `get-theme-file` of `get-theme-files` voor conflict-safe writes.
- Verifieer single-file writes bij voorkeur inline via `upsert-theme-file.verifyAfterWrite=true`; gebruik `get-theme-file` alleen als je daarna nog een gerichte readback nodig hebt. Gebruik bij batch writes waar mogelijk `verifyAfterWrite` of `verify-theme-files`.
- `resolve-template-sections` retourneert compacte, afleidbare velden zoals `displayTitle`, `schemaName`, `presetNames` en `sourceFiles`, zodat de planningsfase tokenzuinig blijft voor homepage-, product-, collection- en andere template-inventory/editing.
- `resolve-homepage-sections` blijft als legacy alias beschikbaar en mapt intern naar `resolve-template-sections` met `pageType=homepage`.
- `find-theme-section-by-name` is lookup-only voor bestaande sections en retourneert routing-hints (`recommendedFlow`, `creationSuggested`) om create-vragen weg te sturen van bestaande lookup-calls. Gebruik optioneel `page` voor gerichte scopes zoals `homepage`, `product` of `collection`.
- `search-theme-files` retourneert alleen gecapte hits met snippets en dumpt geen volledige bestanden tenzij daar expliciet om wordt gevraagd.
- Gebruik `list_theme_import_tools` alleen voor metadata/advisering over externe tooling (bijv. lokale Chrome MCP en Shopify Dev MCP), niet voor normale native section-create requests.

Externe workflow:
`AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`

## Compat & migratie
- Nieuwe toolnamen: `resolve-template-sections`, `find-theme-section-by-name`, `search-theme-files`, `create-theme-section`.
- Legacy alias: `resolve-homepage-sections` blijft backwards compatible en is beperkt tot homepage-resolutie.
- Bestaande tracking-aliases `update-order-tracking` en `add-tracking-to-order` blijven backwards compatible via `set-order-tracking`.
- `get-license-status` rapporteert additief ook MCP-scopecontext naast licentie-informatie.
- `docs/16-SECTION-CLONE-RUNNER.md` is gearchiveerd naar `docs/archive/16-SECTION-CLONE-RUNNER.md`; de actieve scope staat nu in dit document en in `docs/14-GPT-INSTRUCTIONS.md`.
