# MCP Server Setup (Index)

## Routes
1. Remote (standaard): `docs/12-REMOTE-MCP-SETUP.md`
2. Local fallback (legacy): `docs/archive/11-LOCAL-MCP-SETUP.md`

## Hard requirements
1. Productie via HTTPS.
2. Remote `/mcp` (Streamable HTTP) is primary route.
3. Shopify credentials alleen via onboarding (server-side), niet in clientconfig.
4. OAuth PKCE `S256` only.
5. `/mcp` accepteert alleen Bearer of `x-api-key`.
6. Origin-validatie blijft actief op browser-origin requests.
7. Productie draait standaard op HTTP transport; gebruik `stdio` alleen nog expliciet als legacy/local fallback.

## Aanbevolen checks na wijzigingen
1. `npm run build`
2. `npm test`

## Tooling-richtlijn sections (staged orchestration)
- Publieke staged tools:
  - `inspect-reference-section`
  - `generate-shopify-section-bundle`
  - `validate-shopify-section-bundle`
  - `import-shopify-section-bundle`
- Compat tool:
  - `replicate-section-from-reference` (wrapper over staged flow met legacy outputvelden)
- Interne adapters:
  - Chrome/browser inspectie via `chrome-mcp` bridge (`chrome-provider-bridge.mjs` -> `chrome-devtools-mcp`)
  - Schema/template validatie via `shopify-dev-mcp` bridge (`shopify-dev-provider-bridge.mjs` -> `@shopify/dev-mcp`)
  - Theme import/verificatie via Shopify Admin in Hazify
- Contractdetails: `docs/18-SECTION-TOOL-CONTRACTS.md`
