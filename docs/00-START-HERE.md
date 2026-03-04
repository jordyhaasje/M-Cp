# Start Here (Codex)

Dit is de vaste leesvolgorde voor agents/LLMs in deze workspace.

## 1) Leesvolgorde
1. `docs/00-START-HERE.md`
2. `docs/01-TECH-STACK.md`
3. `docs/02-SYSTEM-FLOW.md`
4. `docs/03-REPO-STRUCTURE.md`
5. `docs/04-AGENT-RUNBOOK.md`
6. `docs/10-MCP-SERVER-SETUP.md`
7. `docs/12-REMOTE-MCP-SETUP.md` (standaardroute)
8. `docs/20-TRACKING-WORKFLOW.md` (alleen bij order tracking)
9. `docs/30-REMOTE-MCP-DEPLOYMENT.md` (bij distributie/deploy/licensing)
10. `AGENTS.md`
11. Servercode in `shopify-mcp-local/dist/`

## 2) Duidelijke scheiding
- Documentatie: `docs/`
- Productie MCP-server: `shopify-mcp-local/`
- License API service: `hazify-license-service/`
- Startpunt server: `shopify-mcp-local/dist/index.js`
- Templates voor nieuwe servers: `templates/mcp-server-template/`
- Legacy docs: `docs/archive/`
- Legacy data/bestanden: `archive/`

## 3) Werkregel
Bij elke codewijziging in `shopify-mcp-local/dist/` moet relevante documentatie in `docs/` direct mee-updaten.
