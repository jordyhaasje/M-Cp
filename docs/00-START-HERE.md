# Start Here
Doelgroep: nieuwe developers en coding agents.

Dit is het startpunt voor de Hazify monorepo. Deze workspace bevat de productiecode voor de Postgres-only License Service, de HTTP-only Remote MCP en de bijbehorende documentatie en scripts.

## Leesvolgorde
1. `docs/00-START-HERE.md` (Dit document)
2. `docs/01-TECH-STACK.md` (Architectuur, env vars, deployment)
3. `docs/02-SYSTEM-FLOW.md` (Auth, OAuth, runtime requests en theme editing)
4. `AGENTS.md` (Root - interne maintainerregels voor AI-agents, mutaties en workflows)

**Gouden regel:** Als documentatie en code elkaar tegenspreken, is de code *altijd* leidend. Update de documentatie in dezelfde wijziging.

## 2. Repo Structuur
De monorepo is opgebouwd via npm workspaces. `src/` is de enige bron van waarheid.

- `apps/hazify-license-service/`: Node.js service voor account, OAuth, billing en token-exchange. (Entry: `src/server.js`)
- `apps/hazify-mcp-remote/`: Remote MCP service via `/mcp`. (Entry: `src/index.js`)
- `docs/`: Alle actieve documentatie.
- `packages/`: Gedeelde packages voor Shopify-logica en MCP utilities.
- `scripts/`: Repo-brede checks, docgeneratie en operationele helper-scripts.

## 3. Standaard Workflow & Runbook
Zorg dat je na wijzigingen altijd de repo verifieert met de verplichte checks:

```bash
npm ci
npm run check:docs
npm run check:repo
npm run build
npm test
```

Vóór productie-deploy:
```bash
npm run check:git-sync
npm run smoke:prod
```
