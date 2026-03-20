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
   - Identificeer altijd eerst via de planningslaag (`resolve-homepage-sections`, `find-theme-section-by-name`, `search-theme-files`).
   - Gebruik `get-theme-file` / `upsert-theme-file(s)` alléén als het bestand echt is bevestigd via de target resolves.
3. **Externe review tooling**: metadata over lokale externe tools is opvraagbaar via `list_theme_import_tools`. Dit vertelt hoe external (local) review workflows moeten worden opgezet.

Model: `AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`
