# Documentatie-index

Gebruik deze map als enige documentatiebron voor operationeel gedrag en MCP-richtlijnen.

## Volgorde
1. `docs/00-START-HERE.md`
2. `docs/01-TECH-STACK.md`
3. `docs/02-SYSTEM-FLOW.md`
4. `docs/03-REPO-STRUCTURE.md`
5. `docs/04-AGENT-RUNBOOK.md`
6. `docs/10-MCP-SERVER-SETUP.md`
7. `docs/12-REMOTE-MCP-SETUP.md`
8. `docs/20-TRACKING-WORKFLOW.md`
9. `docs/30-REMOTE-MCP-DEPLOYMENT.md`

## Scheiding actief vs archief
- Actief (productie): alle bestanden in `docs/` behalve `docs/archive/`
- Archief/legacy: `docs/archive/`
- Niet-documentatie archief: `archive/`

## Auth model (remote)
- OAuth-first voor clients zoals ChatGPT (via `.well-known` discovery)
- API token/header blijft beschikbaar voor legacy clients

## Gerelateerd
- Productie MCP-servercode: `shopify-mcp-local/`
- License API service: `hazify-license-service/`
- Server template: `templates/mcp-server-template/`
- Legacy connector templates: `docs/archive/connectors-legacy/`

## Trackers
- Actieve opschoonstatus: `docs/90-REPO-CLEANUP-TRACKER.md`
- Historische implementatietracker: `docs/archive/99-IMPLEMENTATION-TRACKER-2026-03-04.md`
