# MCP Server Setup (Index)

Deze workspace heeft twee setup-routes (strikt gescheiden):

1. Remote (aanbevolen): `docs/12-REMOTE-MCP-SETUP.md`
2. Local (legacy/fallback): `docs/archive/11-LOCAL-MCP-SETUP.md`

## Hard requirements
1. Productie altijd via HTTPS.
2. Tracking-updates alleen via fulfillment-tracking tools.
3. Geen placeholders (`<...>`) in echte configwaarden.
4. Na toolwijzigingen: MCP-client herstarten.
5. Shopify credentials voor remote flow altijd via `/onboarding`, niet in clientconfig.
6. `HAZIFY_FREE_MODE=true` is standaard: onboarding werkt zonder betaalstap.
7. Remote MCP moet OAuth discovery endpoints publiceren voor clients zoals ChatGPT.

## Aanbevolen checks na wijziging
1. `node --check /Users/jordy/Desktop/Customer service/shopify-mcp-local/dist/index.js`
2. `node --check /Users/jordy/Desktop/Customer service/hazify-license-service/server.js`
3. `get-order-by-id` werkt met `1004`, `#1004` en GID.
4. `set-order-tracking` update zichtbaar in `order.tracking.shipments`.
