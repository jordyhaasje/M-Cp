# Start Here
Doelgroep: nieuwe developers en coding agents.

Dit is het startpunt voor de Hazify monorepo. Deze workspace draait de productiecode voor Hazify's remote MCP-integratie met Shopify.

## 1. Leesvolgorde (Verplicht)
1. `docs/00-START-HERE.md` (Dit document)
2. `docs/01-TECH-STACK.md` (Architectuur, env vars, deployment)
3. `docs/02-SYSTEM-FLOW.md` (Auth, OAuth, Runtime requests)
4. `AGENTS.md` (Root - Operationele regels voor AI-agents, mutaties, tracking)

**Gouden regel:** Als documentatie en code elkaar tegenspreken, is de code *altijd* leidend. Update de documentatie in dezelfde wijziging.

## 2. Repo Structuur
De monorepo is opgebouwd via npm workspaces. `src/` is de enige bron van waarheid. Er is geen `archive` of handmatig aangepaste `dist/`.

- `apps/hazify-license-service/`: Node.js service voor account, OAuth, billing en token-exchange. (Entry: `src/server.js`)
- `apps/hazify-mcp-remote/`: Remote MCP service via `/mcp`. (Entry: `src/index.js`)
- `packages/shopify-core/`: Gedeelde Shopify logica (`normalizeShopDomain`, `REQUIRED_SHOPIFY_ADMIN_SCOPES`, en gecentraliseerde GraphQL error afhandeling via `assertNoUserErrors`).
- `packages/mcp-common/`: Gedeelde utility functies en scope string afhandeling.
- `docs/`: Alle actieve documentatie.

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
