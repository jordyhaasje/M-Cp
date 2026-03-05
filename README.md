# Customer service Workspace

Operationele workspace voor Shopify/Gmail workflows en Hazify MCP distributie.

## Structuur
- Documentatie: [docs/](/Users/jordy/Desktop/Customer service/docs)
- Legacy docs: [docs/archive/](/Users/jordy/Desktop/Customer service/docs/archive)
- MCP server: [shopify-mcp-local/](/Users/jordy/Desktop/Customer service/shopify-mcp-local)
- License service: [hazify-license-service/](/Users/jordy/Desktop/Customer service/hazify-license-service)
- Template: [templates/mcp-server-template/](/Users/jordy/Desktop/Customer service/templates/mcp-server-template)

## Leesvolgorde
1. [docs/00-START-HERE.md](/Users/jordy/Desktop/Customer service/docs/00-START-HERE.md)
2. Volg daarna exact de volgorde in `00-START-HERE.md` (single source).

## Productie endpoints
- License service: `https://hazify-license-service-production.up.railway.app`
- Remote MCP: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Snelle live test (gratis flow)
- Script: `/Users/jordy/Desktop/Customer service/hazify-license-service/scripts/run-free-onboarding-smoke-test.sh`

## Richting
- Remote setup is standaard.
- Local setup is alleen fallback.
- Gratis onboarding is standaard (`HAZIFY_FREE_MODE=true`).
- OAuth-first voor moderne clients (VS Code, Cursor, ChatGPT, Claude).
- API-token/header route blijft alleen fallback voor clients zonder OAuth.
- Legacy niet-documentatie staat in `archive/`.
