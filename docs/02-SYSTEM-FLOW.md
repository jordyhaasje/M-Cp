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
3. MCP service valideert origin-allowlist indien `Origin` header aanwezig is
4. tenant + Shopify auth wordt resolved
5. tool draait binnen tenant-context
6. response bevat MCP content + structuredContent

## 4) Compatibiliteit
- OAuth-first: VS Code, Cursor, ChatGPT, Claude
- API token fallback voor clients zonder OAuth-flow
- legacy aliases (`/register`, `/authorize`, `/token`) blijven ondersteund

## 5) Section orchestration flow (staged)
1. `inspect-reference-section` analyseert referentie-URL (+ optionele image) via Chrome-inspector adapter
2. `generate-shopify-section-bundle` maakt section bundle op basis van `inspectionId`
3. `validate-shopify-section-bundle` draait schema/template + visual checks op `bundleId`
4. `import-shopify-section-bundle` schrijft pas na readiness check en verifieert readback/render
5. Compat-tool `replicate-section-from-reference` orkestreert dezelfde stages en behoudt legacy response shape
