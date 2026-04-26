# Remediation Plan
Doelgroep: maintainers, release owners en coding agents.

Dit document is geen historische changelog meer. Het is de actuele releasekaart voor de Hazify monorepo: wat is opgelost, wat staat nog open, welke docs blijven actief en wanneer mag een wijziging naar productie.

## Status
- De acht bekende P1/P2 review findings zijn opgelost in code en beschreven in `docs/04-MCP-REMOTE-AUDIT.md`.
- De repo draait met een Postgres-only License Service en een HTTP-only Remote MCP.
- De MCP Remote gebruikt PostgreSQL voor `theme_drafts` en advisory locks.
- Railway runtime-start gebruikt direct Node via `railway.json` en `scripts/start-service.mjs`; dit is live bevestigd op MCP Remote deployment `2d3eb307-cd8b-40b5-9bff-25163ddd0124` en License Service deployment `301768ee-8860-494e-8e37-e89ea4a84ce3`.
- MCP theme edit hardening voor preserve-on-edit rewrites en generieke section authoring contracts is live op commit `553cdce`.
- Er wordt nu geen document verwijderd.

## Actieve Patch
De production-readiness patch op commit `158d0f3` heeft de resterende operationele en documentatiepunten afgehandeld:

- Root Railway startcommand vastleggen in `railway.json`.
- Root start scripts laten wijzen naar `scripts/start-service.mjs` zonder geneste `npm run`.
- `scripts/check-repo-hygiene.mjs` laten falen wanneer startconfig terugvalt naar geneste npm-starts.
- `docs/04-MCP-REMOTE-AUDIT.md` compact maken tot actuele auditwaarheid.
- `docs/05-REMEDIATION-PLAN.md` compact maken tot releasekaart.
- README's en docs-indexen bijwerken zodat nieuwe developers en coding agents de repo direct begrijpen.

## Release Checklist
1. Lees `docs/00-START-HERE.md`, `docs/01-TECH-STACK.md`, `docs/02-SYSTEM-FLOW.md` en `AGENTS.md`.
2. Draai lokaal:
   ```bash
   npm run check:docs
   npm run check:repo
   npm run release:preflight
   npm audit --omit=dev
   ```
3. Controleer dat `git diff --check` schoon is.
4. Commit met een duidelijke productie-readiness boodschap.
5. Merge pas naar `main` wanneer lokale gates groen zijn.
6. Push `main`.
7. Redeploy beide Railway services wanneer root runtime, shared packages, license service of MCP remote zijn geraakt.
8. Draai na deploy:
   ```bash
   npm run smoke:prod
   ```
9. Controleer Railway deployment metadata en logs via Railway MCP.

## Docs Cleanup Besluit
- `docs/00-START-HERE.md` blijft de leesvolgorde.
- `docs/01-TECH-STACK.md` blijft architectuur, env vars, deployment en observability.
- `docs/02-SYSTEM-FLOW.md` blijft systeemflow en toolruntime.
- `docs/03-THEME-SECTION-GENERATION.md` blijft de theme generation gids.
- `docs/04-MCP-REMOTE-AUDIT.md` blijft de actuele audit en code-map.
- `docs/05-REMEDIATION-PLAN.md` blijft de actuele releasekaart.
- Oude batchgeschiedenis wordt niet als lang verhaal bewaard in actieve docs. Alleen actuele status, bewijs, open punten en release-acties blijven staan.

## Open Punten
- Maak een aparte read-only MCP smoke-token aan en verifieer live dat write-tools met alleen `mcp:tools:read` worden geweigerd.
- Blijf de upstream `punycode` waarschuwing vanuit `@shopify/theme-check-node` monitoren wanneer theme linting actief is.

## Productie Waarheid
- Gebruikers koppelen hun Shopify store in de License Service met een Admin API access token uit een merchant-created custom app.
- App key/secret blijft ondersteund voor trusted app-achtige setups, maar is niet de primaire merchant-route.
- Theme file edits vereisen Shopify theme file write access/exemption naast `write_themes`; de MCP meldt ontbrekende toegang als `theme_write_exemption_required`.
- MCP-clients verbinden met de Remote MCP via de publieke `/mcp` endpoint en een bearer token of API key.
- De MCP Remote introspecteert credentials bij de License Service, haalt server-side de Shopify access token op via interne token-exchange en geeft die nooit terug aan de client of LLM.
- Theme writes zijn altijd theme-targeted, guarded, gevalideerd en waar mogelijk verify-after-write bevestigd.

## Handoff Voor Agents
- Gebruik de toolregistry als bron van waarheid voor toolnamen.
- Werk docs bij in dezelfde wijziging wanneer codegedrag wijzigt.
- Gebruik `themeRole="main"` alleen voor de live theme; gebruik voor andere roles altijd een exact `themeId`.
- Gebruik `apply-theme-draft` nooit als eerste write-tool voor een nieuwe section.
- Geef in eindrapportage altijd door wat is aangepast, welke checks zijn uitgevoerd, wat live is gedeployed en welke punten nog input van de gebruiker vragen.
