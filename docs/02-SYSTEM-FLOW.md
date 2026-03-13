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
4. authorize via `/oauth/authorize` met PKCE `S256`
5. token exchange via `/oauth/token`
6. access token wordt gebruikt op `/mcp`

## 3) MCP request flow
1. client roept `/mcp` aan met Bearer token of `x-api-key`
2. MCP service valideert token via `/v1/mcp/token/introspect`
3. MCP service haalt tenant-gebonden Shopify access token op via `/v1/mcp/token/exchange` (service-to-service)
4. MCP service valideert origin-allowlist indien `Origin` header aanwezig is
5. tool draait request-scoped binnen tenant-context (geen globale mutable Shopify state)
6. response bevat MCP content + structuredContent

## 4) Compatibiliteit
- OAuth-first: VS Code, Cursor, ChatGPT, Claude
- API token fallback voor clients zonder OAuth-flow
- legacy aliases (`/register`, `/authorize`, `/token`) blijven ondersteund
- default MCP session mode: stateless (`MCP_SESSION_MODE=stateless`)
- stateful mode alleen expliciet en met sticky sessions of gedeelde session store

## 5) Externe theme import flow
De remote Hazify MCP importeert geen sections.

Externe flow:
1. AI client bepaalt benodigde import-tool via `list_theme_import_tools`
2. AI client gebruikt lokale toolstack buiten Hazify:
   - Chrome MCP (optioneel voor visuele inspectie)
   - Shopify Dev MCP (voor section import in theme)
3. Theme-wijzigingen gebeuren buiten deze repository

Kort model: `AI Client -> Chrome MCP / Shopify Dev MCP -> Theme modifications`
