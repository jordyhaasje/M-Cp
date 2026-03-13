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
8. Session mode default is `stateless`; `stateful` alleen met sticky sessions of gedeelde session store.

## Aanbevolen checks na wijzigingen
1. `npm run build`
2. `npm test`

## Theme import tooling policy
- Hazify MCP importeert geen generated sections.
- Gebruik `list_theme_import_tools` om externe tooling metadata op te vragen.
- Externe flow:
  - `AI Client -> Chrome MCP / Shopify Dev MCP -> Theme modifications`
