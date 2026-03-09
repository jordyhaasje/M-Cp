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

## Aanbevolen checks na wijzigingen
1. `npm run build`
2. `npm test`

## Tooling-richtlijn sections (v3)
- Enige publieke section-tool: `replicate-section-from-reference`
- Pipeline is intern deterministisch: capture -> detect -> generate -> lint -> strict visual gate -> apply
- Oudere section-tools zijn verwijderd (geen wrappers of feature-flags meer)
- Contractdetails: `docs/16-SECTION-REPLICA-RUNBOOK.md`
