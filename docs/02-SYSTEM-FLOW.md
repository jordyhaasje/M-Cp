# System Flow (Runtime & Integratie)
Doelgroep: repo maintainers en AI-agents.

Dit document beschrijft hoe aanvragen, authenticatie en store integraties op de actuele codebase functioneren.

## 1. Onboarding & Credentials
1. Een gebruiker registreert zich op de License Service en koppelt zijn Shopify winkel via `shopAccessToken` of `shopClientId` / `shopClientSecret`.
2. Validatie controleert op `REQUIRED_SHOPIFY_ADMIN_SCOPES` (inclusief `read_themes`, `write_themes`).
3. Credentials en secrets blijven **100% server-side** op de License Service en worden nooit via de frontend aan de MCP client doorgegeven.

## 2. Authenticatie: OAuth PKCE (Voorkeur) & Fallback
Vanaf 2026 ondersteunt Hazify native OAuth 2.0 PKCE.
1. **Discovery:** Client ontdekt auth servers via `/.well-known/oauth-protected-resource`.
2. **Authorize Flow:** `GET /oauth/authorize` levert de visuele login pagina. Toestemming (of weigering) gaat via een specifieke form submit op `POST /oauth/authorize`.
   - De authorize submit (POST) onthoudt de *originele* OAuth-parameters, inclusief de `resource` parameter.
   - Origin van `redirect_uri` wordt in de CSP `form-action` geladen, zodat redirects naar platforms zoals `https://chatgpt.com` netjes lukken.
3. **Token:** `/oauth/token` wisselt autorisatiecode in voor access tokens.
*(Fallback: API tools tokens gegenereerd op het web dashboard zijn bruikbaar voor pure API of legacy connectors.)*

## 3. Remote MCP Request Lifecycle (`/mcp`)
De service (`mcp-remote/src/index.js`) luistert op het HTTP-transport.
1. Een request bevat een token (via Bearer of `x-api-key`). Geen query parameters.
2. Controle op `Origin` (indien meegeleverd) versus allowlist in `isOriginAllowed`.
3. Verificatie via introspection aan de license service (`/v1/mcp/token/introspect`). Check licentiestatus en tool/mutation entitlements (`context.license.entitlements.tools`, etc).
4. **Lazy Token Exchange:** Shopify-autorisatie (`/v1/mcp/token/exchange`) vindt alleen plaats vóór evaluatie van een tool die écht met Shopify moet babbelen. De aanroepen naar MCP's `initialize` en `tools/list` omzeilen dit en zijn zeer snel.
5. De operatie wordt gelimiteerd door in-memory scopes (o.a. `mcp:tools:read` vs `mcp:tools:write`).

## 4. Theme Import Beleid & Tools
De Remote MCP implementeert **géén eigen browser runtime of local generation**. 
1. **Native OS 2.0 Section Creation:** Maken en plaatsen van JSON gebaseerde OS 2.0 componenten gaat uitsluitend direct via `create-theme-section`.
2. **Resolve en Edit:** Om tokenoverhead en trage readbacks te minimaliseren voor AI agents:
   - Identificeer altijd eerst via `search-theme-files` voordat je een bestand opent of aanpast.
   - Gebruik `get-theme-file` / `upsert-theme-file(s)` alléén als het bestand echt is bevestigd via de target resolves.
4. **Externe review tooling**: metadata over lokale externe tools is opvraagbaar via `list_theme_import_tools`. Dit vertelt hoe external (local) review workflows moeten worden opgezet.
5. **Visuele UI Scrapen (Referenties):** De MCP heeft een ingebouwde token-geoptimaliseerde scraper (`analyze-reference-ui`). Deze laadt websites in via `cheerio`, stript agressief zware elementen (zoals SVG, script, data-uri afbeeldingen) en retourneert class/id structuren als compacte Pug-achtige Markdown. Dit verhoogt de context window stabiliteit aanzienlijk bij referentie-onderzoek.
6. **Theme Development Best Practices (LLM Instructies):**
   - **Stop Guessing:** AI-agents mogen NOOIT blind gokken naar bestandsnamen zoals 'base.css' of 'product.json'. Ze moeten verplicht `search-theme-files` gebruiken.
   - **Asset Registration:** Als de AI een nieuw CSS/JS asset aanmaakt, weet het dat Shopify dit niet automatisch inlaadt. Het moet expliciet gekoppeld worden in de layout (bijv. in `layout/theme.liquid` via `{{ 'filename.css' | asset_url | stylesheet_tag }}`).

Model: `AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`

## 5. Veiligheid, Rate Limiting & Tool Hardening

De Remote MCP beschikt over diepliggende veiligheidsmechanismen tegen malformatie en LLM-hallucinaties:
1. **Tenant Isolation:** Iedere integratie en tool call is strict geïsoleerd op de shop en tenant van de gekoppelde GraphQL/REST sessie. Cross-tenant data leakages door AI LLM-hallucineren is hiermee op netwerk- en applicatieniveau fundamenteel geblokkeerd.
2. **Tool Hardening (Zod Validaties):** Gevaarlijke of destructieve mutaties vereisen expliciete `confirmation` strings en een `auditReason`. De exacte literals zijn: `"CREATE_THEME_SECTION"`, `"UPSERT_THEME_FILE"`, `"UPSERT_THEME_FILES"`, `"DELETE_THEME_FILE"`. Als de argumenten missen of invalid zijn, blokkeert Zod de API call. *(Voor AI-agents: "OpenAI safety check" errors tijdens writes betekenen vrijwel altijd een gefaalde Zod validatie. Controleer de schema-argumenten via `AGENTS.md`.)*
3. **Smart JSON Safeguard:** Via API JSON templates aanmaken of wijzigen (`templates/*.json` en `config/*.json`) is een harde blokkade, ter bescherming van homepage destructie. De LLM stuurt losse theme bestanden aan, waarna de merchant zélf via z'n Theme Editor kan plaatsen.
4. **Core File Protection:** Kritieke infrastructuur-bestanden (zoals `layout/theme.liquid`) blokkeren API saves indien vitale tags, specifiek `{{ content_for_header }}` en `{{ content_for_layout }}`, ontbreken in de payload. Ze mogen bovendien nooit via integraties verwijderd worden.
5. **API Rate Limiting & Batch Limits (Exponential Backoff):** De Shopify REST Asset API (gebruikt voor theme files) is onderhevig aan strenge request limits. Om Out-Of-Memory (OOM) crashes op de Railway server en timeouts te voorkomen, is er op alle opslag- en leesoperaties (zoals `upsert-theme-files`, `get-theme-files` en `verify-theme-files`) een **harde Zod-limiet van maximaal 10 bestanden** ingesteld per request. Theme-operaties hergebruiken voorts automatische interne  *Exponential Backoff* mechanismes om succes op bulk mutaties te garanderen en HTTP 429-errors netjes af te vangen.
6. **Distributed Concurrency Locks:** Om concurrerende wijzigingen in single-files over meerdere applicatie-containers (op Railway) veilig te serialiseren, wordt er voor iedere theme schrijfoperatie een deterministische *PostgreSQL Advisory Lock* afgedwongen (i.p.v. memory-locks). Toekomstige draft-edits en staging logica steunen op the PostgreSQL `theme_drafts` backend tabel voor schaalbare integratie.
7. **Defense in Depth (LLM Hallucinations):** Systeem-tools bevatten interne fallbacks (zoals de `content` -> `value` auto-mapping) én agressieve Zod schema validaties om veelvoorkomende parameter-fouten van LLM's te herstellen zonder dat de request stuk loopt.
