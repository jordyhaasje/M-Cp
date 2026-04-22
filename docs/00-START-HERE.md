# Start Here
Doelgroep: nieuwe developers en coding agents.

Dit is het startpunt voor de Hazify monorepo. Deze workspace bevat de productiecode voor de Postgres-only License Service, de HTTP-only Remote MCP en de bijbehorende documentatie en scripts.

## Leesvolgorde
1. `docs/00-START-HERE.md` (Dit document)
2. `docs/01-TECH-STACK.md` (Architectuur, env vars, deployment)
3. `docs/02-SYSTEM-FLOW.md` (Auth, OAuth, runtime requests en theme editing)
4. `docs/03-THEME-SECTION-GENERATION.md` (Canonical section/block generatieflows en voorbeelden)
5. `docs/04-MCP-REMOTE-AUDIT.md` (Levende audit, blockers, acceptatiecriteria en bron van waarheid)
6. `docs/05-REMEDIATION-PLAN.md` (Actieve tracker voor patchbatches, sessie-handoff en releasevolgorde)
7. `AGENTS.md` (Root - interne maintainerregels voor AI-agents, mutaties en workflows)

**Gouden regel:** Als documentatie en code elkaar tegenspreken, is de code *altijd* leidend. Update de documentatie in dezelfde wijziging.

## 2. Repo Structuur
De monorepo is opgebouwd via npm workspaces. `src/` is de enige bron van waarheid.

- `apps/hazify-license-service/`: Node.js service voor account, OAuth, billing en token-exchange. (Entry: `src/server.js`)
- `apps/hazify-mcp-remote/`: Remote MCP service via `/mcp`. (Entry: `src/index.js`)
- `docs/`: Alle actieve documentatie.
- `packages/`: Gedeelde packages voor Shopify-logica en MCP utilities.
- `scripts/`: Repo-brede checks, docgeneratie en operationele helper-scripts.

## 3. Actieve Onderhoudsdocs
- `docs/03-THEME-SECTION-GENERATION.md`: praktijkgids voor screenshot/text-only section generation, native block flows, placement en structurele generation-regels
- `docs/04-MCP-REMOTE-AUDIT.md`: canonieke audit voor MCP-gedrag, blockers, confirmed issues, bewijs en acceptatiecriteria
- `docs/05-REMEDIATION-PLAN.md`: canonieke tracker voor patchbatches, sessie-handoff, docs-governance en releasevolgorde

## 4. Standaard Workflow & Runbook
Gebruik onderstaande fases als canonieke releasevolgorde. `npm run smoke:prod` hoort nadrukkelijk pas ná een Railway deploy.

### Pre-commit
1. Draai eerst `npm run release:status` om te zien:
   - of er nog een lokale commit nodig is
   - of er al commits ahead van `origin/main` staan
   - welke Railway service(s) na push een redeploy nodig hebben
2. Draai daarna minimaal de relevante lokale gates voor de gewijzigde scope.
3. Gebruik `npm run release:preflight` wanneer je shared code, runtime-code of meerdere workspaces hebt geraakt.

Volledige lokale preflight:
```bash
npm run release:preflight
```

### Commit-gate
- Commit lokaal zodra de bedoelde wijziging inhoudelijk af is en de relevante lokale gates groen zijn.
- Code-based Railway deploys gaan pas door nadat de bedoelde wijzigingen zijn gecommit.
- Docs-only of test-only wijzigingen vereisen geen Railway redeploy.

### Pre-push
- Gebruik `npm run check:git-sync` als parity-check tegen `origin/main`.
- `check:git-sync` is geen volledige release-gate: het controleert ahead/behind en push-auth, maar niet of Railway al dezelfde runtime draait.
- Push eerst naar remote voordat je een code-based Railway deploy uitvoert.

### Redeploy-beslisregels
- `apps/hazify-mcp-remote/src/**`, `apps/hazify-mcp-remote/packages/**`, `apps/hazify-mcp-remote/package.json` => redeploy `Hazify-MCP-Remote`
- `apps/hazify-license-service/src/**`, `apps/hazify-license-service/packages/**`, `apps/hazify-license-service/package.json` => redeploy `Hazify-License-Service`
- `packages/**`, root `package.json`, root `package-lock.json` => doorgaans beide services redeployen
- `docs/**`, `AGENTS.md`, test-only wijzigingen => geen Railway redeploy
- Railway env-only wijzigingen kunnen ook zonder nieuwe commit een redeploy vereisen; documenteer dat expliciet in `docs/05-REMEDIATION-PLAN.md`

### Post-deploy
```bash
npm run release:postdeploy
```

- Controleer daarna Railway deployment metadata en runtime logs.
- Markeer een change pas als live bevestigd wanneer:
  - de bedoelde deploy succesvol is
  - `npm run smoke:prod` op de live URLs slaagt
  - de relevante Railway logs geen nieuw terugkerend foutpatroon tonen
