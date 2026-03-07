# System Flow

## 1) Onboarding flow
1. gebruiker opent `/onboarding`
2. ziet exact 2 start-cards: `Inloggen` of `Account maken`
3. voert account-flow uit via `/login` of `/signup`
4. bij succesvolle sessie opent `/dashboard`
5. gebruiker koppelt één of meerdere winkels in hetzelfde account
6. dashboard haalt state op via `/v1/session/bootstrap` + `/v1/dashboard/state`
7. gebruiker kiest actieve winkel, verbindt apps en maakt alleen waar nodig een nieuwe verbindingscode via `/v1/dashboard/mcp-token/*`

## 2) OAuth flow (aanbevolen)
1. client leest MCP `/.well-known/oauth-protected-resource`
2. client ontdekt auth server metadata
3. client registreert zichzelf via `/oauth/register`
4. gebruiker autoriseert via `/oauth/authorize` met actieve accountsessie (en kiest winkel als er meerdere zijn)
5. authorize vereist PKCE `code_challenge` met methode `S256` en scope `mcp:tools`
6. client wisselt code in via `/oauth/token`
7. token exchange accepteert alleen geldige `S256` code_verifier
8. access token wordt gebruikt op MCP `/mcp`

## 3) MCP request flow
1. client roept `/mcp` aan met `Authorization: Bearer` of `x-api-key`
2. MCP service valideert token via `/v1/mcp/token/introspect`
3. bij browser-origin requests valideert MCP service de `Origin` header
4. MCP service resolveert tenant + Shopify credentials
5. tool draait binnen tenant-context
6. response bevat MCP content + structuredContent

## 4) Compatibiliteit
- OAuth clients: VS Code, Cursor, ChatGPT, Claude en moderne MCP clients
- direct config clients: Perplexity/legacy clients via dashboard setup-snippets
- legacy OAuth route probing (`/register`): ondersteund via redirect

## 5) Foutpatronen
- `Cannot POST /register`: oude deploy of fout endpoint
- `client_secret Input should be a valid string`: oude DCR implementatie
- `406 Not Acceptable` bij handmatige `/mcp` calls: `Accept` header moet zowel `application/json` als `text/event-stream` accepteren
- `401 Missing API token`: client gebruikt query-token of non-Bearer authorization; alleen Bearer/x-api-key is toegestaan
- `403 Forbidden: Origin ... is not allowed`: `Origin` valt buiten allowlist voor `/mcp`
