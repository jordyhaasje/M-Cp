# Remediation Plan
Doelgroep: maintainers, release owners en coding agents.

Dit document is de actuele releasekaart voor de Hazify monorepo. Het is geen changelog: oude patchrondes, vaste deployment IDs en tijdelijke notities horen niet in actieve docs.

## Status
- De repo draait met een Postgres-only License Service en een HTTP-only Remote MCP.
- Railway runtime-start gebruikt direct Node via `railway.json` en `scripts/start-service.mjs`.
- MCP Remote gebruikt PostgreSQL voor `theme_drafts`, verify/apply state en advisory locks.
- License Service production startup vereist sterke admin/MCP secrets, `HAZIFY_FREE_MODE=false`, resource-bound MCP tokens en test-only signup auto-activation uit.
- Theme generation is gericht op hogere first-pass success rate en lager tokenverbruik via compact planner output, preflight bundling, compact failure responses en server-side context waar veilig.
- Theme section codegen preflight gebruikt nu tolerante JSON-schema blockrol-detectie: feature-rijke `slide` blocks met video/avatar/review/quote/secondary CTA settings blijven slide blocks, per-slide video-prompts worden niet meer door section-level video als compleet behandeld, en compact diagnostics bevatten gedetecteerde blocks plus prompt-coverage.
- Section generation is nu contract-first: compacte `plan-theme-edit` responses bevatten `sectionContract`, `codegenPrompt` en `completionGate`; create-mode writes blokkeren op ontbrekende of partial prompt coverage; generieke settingtype-matches zijn aangescherpt; FAQ/tab/comparison blockrollen krijgen specifieke schema-diagnostics.
- New-section theme-context is fallback-aware: een missende representatieve planner-read wordt vóór handoff vervangen door een bestaande section en write-tools accepteren `substituteRepresentativeRead` voor net-new standalone creates, terwijl missende helper/native/edit reads hard blockers blijven.

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
5. Push `main`.
6. Redeploy `Hazify-MCP-Remote` en/of `Hazify-License-Service` volgens `npm run release:status`.
7. Draai na deploy:
   ```bash
   HAZIFY_REQUIRE_AUTHENTICATED_MCP_SMOKE=true HAZIFY_REQUIRE_WRITE_SCOPE_GATE=true npm run smoke:prod
   ```
8. Controleer Railway deployment metadata en runtime logs voor nieuwe errorreeksen.

## Redeploy-Regels
- `apps/hazify-mcp-remote/src/**`, MCP package mirrors of MCP `package.json`: redeploy MCP Remote.
- `apps/hazify-license-service/src/**`, license package mirrors of license `package.json`: redeploy License Service.
- `packages/**`, root `package.json`, root `package-lock.json`, `railway.json` of `scripts/start-service.mjs`: redeploy beide services.
- `docs/**`, `AGENTS.md` en test-only wijzigingen: geen Railway redeploy.
- Env-only changes kunnen zonder codecommit een redeploy vereisen; noteer dit in de release-output.

## Docs Governance
- `docs/README.md` is de index van actieve docs.
- `docs/03-THEME-SECTION-GENERATION.md` blijft de uitgebreide theme generation gids.
- `docs/04-MCP-REMOTE-AUDIT.md` blijft de compacte audit en code-map.
- Oude deployment IDs, patchgeschiedenis en “nu gefixt” notities worden verwijderd zodra ze geen operationele waarde meer hebben.

## Open Punten
- Maak een aparte read-only MCP smoke-token aan en verifieer live dat write-tools met alleen `mcp:tools:read` worden geweigerd.
- Breid persistente `mutation_audit_logs` verder uit naar refunds, theme deletes en overige store mutaties.
- Voeg echte Postgres advisory-lock tests toe aan CI/release wanneer een gedeelde testdatabase beschikbaar is.
- Blijf de upstream `punycode` waarschuwing vanuit `@shopify/theme-check-node` monitoren wanneer theme linting actief is.

## Handoff Voor Agents
- Gebruik de toolregistry als bron van waarheid voor toolnamen.
- Werk docs bij in dezelfde wijziging wanneer codegedrag wijzigt.
- Gebruik `themeRole="main"` alleen voor de live theme; gebruik voor andere roles altijd een exact `themeId`.
- Gebruik `apply-theme-draft` nooit als eerste write-tool voor een nieuwe section.
- Geef in eindrapportage altijd door wat is aangepast, welke checks zijn uitgevoerd, wat live is gedeployed en welke punten nog input van de gebruiker vragen.
