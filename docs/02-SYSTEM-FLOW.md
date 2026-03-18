# System Flow

## 1) Onboarding flow
1. gebruiker opent `/onboarding`
2. kiest `Inloggen` of `Account maken`
3. accountflow via `/login` of `/signup`
4. bij succes opent `/dashboard`
5. gebruiker koppelt winkel met `shopAccessToken` of `shopClientId + shopClientSecret`
6. onboarding valideert credentials + vereiste scopes (incl. `read_themes`/`write_themes`)
7. gebruiker maakt MCP token via dashboard

## 2) OAuth flow (aanbevolen)
1. client leest `/.well-known/oauth-protected-resource`
2. client ontdekt auth server metadata
3. dynamic client registration via `/oauth/register`
4. authorize via `GET /oauth/authorize` met PKCE `S256`
5. authorize UI rendert alleen; toestaan/weigeren loopt via `POST /oauth/authorize`
6. authorize POST bewaart de originele OAuth-context (`response_type`, `client_id`, `redirect_uri`, `state`, `scope`, `code_challenge`, `code_challenge_method`, `resource`)
7. submit-regel: form body wint, querystring is alleen fallback/continuity; mismatch op gevoelige velden resulteert in `invalid_request`
8. interactieve OAuth CSP laat de `redirect_uri`-origin toe in `form-action` zodat browserredirects naar connector-clients (bijv. ChatGPT) niet geblokkeerd worden
9. token exchange via `/oauth/token`
10. access token wordt gebruikt op `/mcp`

## 3) MCP request flow
1. client roept `/mcp` aan met Bearer token of `x-api-key`
2. MCP service valideert token via `/v1/mcp/token/introspect`
3. MCP service evalueert request context + licentiebeleid
4. MCP service valideert origin-allowlist indien `Origin` header aanwezig is
5. Shopify token exchange gebeurt lazy via `/v1/mcp/token/exchange` alleen als de gekozen tool Shopify-auth nodig heeft
6. `initialize`, `tools/list` en context-free tools triggeren geen Shopify exchange
7. tool draait request-scoped binnen tenant-context (geen globale mutable Shopify state)
8. response bevat MCP content + structuredContent

## 4) Compatibiliteit
- OAuth-first: VS Code, Cursor, ChatGPT, Claude
- API token fallback voor clients zonder OAuth-flow
- legacy aliases (`/register`, `/authorize`, `/token`) blijven ondersteund
- default MCP session mode: stateless (`MCP_SESSION_MODE=stateless`)
- stateful mode alleen expliciet en met sticky sessions of gedeelde session store

## 5) Externe theme import flow
De remote Hazify MCP importeert geen sections.
De remote Hazify MCP ondersteunt wel theme file deploy/verificatie:
- single-file: `get-theme-file`, `upsert-theme-file`, `delete-theme-file`
- batch v2: `get-theme-files`, `upsert-theme-files`, `verify-theme-files`

Externe flow:
1. AI client bepaalt benodigde externe import/review tooling via `list_theme_import_tools` (metadata/advisering)
2. AI client gebruikt lokale toolstack buiten Hazify:
   - Chrome MCP (optioneel voor visuele inspectie)
   - Shopify Dev MCP (voor section import in theme)
3. Lokale toolstack levert voorbereide theme-bestanden op
4. Hazify remote schrijft en verifieert die bestanden op de target theme

Kort model: `AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`
