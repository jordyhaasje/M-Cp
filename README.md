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
2. [docs/01-TECH-STACK.md](/Users/jordy/Desktop/Customer service/docs/01-TECH-STACK.md)
3. [docs/02-SYSTEM-FLOW.md](/Users/jordy/Desktop/Customer service/docs/02-SYSTEM-FLOW.md)
4. [docs/03-REPO-STRUCTURE.md](/Users/jordy/Desktop/Customer service/docs/03-REPO-STRUCTURE.md)
5. [docs/04-AGENT-RUNBOOK.md](/Users/jordy/Desktop/Customer service/docs/04-AGENT-RUNBOOK.md)
6. [docs/10-MCP-SERVER-SETUP.md](/Users/jordy/Desktop/Customer service/docs/10-MCP-SERVER-SETUP.md)
7. [docs/12-REMOTE-MCP-SETUP.md](/Users/jordy/Desktop/Customer service/docs/12-REMOTE-MCP-SETUP.md)
8. [docs/30-REMOTE-MCP-DEPLOYMENT.md](/Users/jordy/Desktop/Customer service/docs/30-REMOTE-MCP-DEPLOYMENT.md)

## Productie endpoints
- License service: `https://hazify-license-service-production.up.railway.app`
- Remote MCP: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Snelle live test (gratis flow)
- Script: `/Users/jordy/Desktop/Customer service/hazify-license-service/scripts/run-free-onboarding-smoke-test.sh`

## Richting
- Remote setup is standaard.
- Local setup is alleen fallback.
- Gratis onboarding is standaard (`HAZIFY_FREE_MODE=true`).
- OAuth is beschikbaar voor multi-client connecties (o.a. ChatGPT).
- Legacy niet-documentatie staat in `archive/`.
