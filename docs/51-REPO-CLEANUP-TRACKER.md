# Repo Cleanup Tracker

Status: actief
Laatste update: 2026-03-10 (Europe/Amsterdam)

## Doel
De repo opschonen in kleine, veilige PR-slices zonder de bestaande remote MCP- en OAuth-connectflow voor eindgebruikers te breken.

## Guardrails
- `/mcp` blijft beschikbaar voor bestaande remote clients.
- OAuth discovery en `/oauth/*` blijven compatibel.
- Connectorvoorbeelden voor ChatGPT en Perplexity blijven bruikbaar.
- Geen cleanup zonder gelijktijdige docs-update.
- Elke slice eindigt met `npm run build` en `npm test`.

## Fases
- [x] Fase 0: cleanup PR-plan en actieve tracker toegevoegd
- [x] Fase 0: actieve docs-index uitgebreid met cleanupdocs
- [x] Fase 0: afgeronde UI/UX-tracker naar archief verplaatst
- [x] Fase 0: ongebruikte docs-assets verwijderd
- [x] Fase 0: kritieke docs-drift in structuur/transport/tech stack aangescherpt
- [x] Fase 1: docs volledig uitlijnen met code
- [x] Fase 2: CI en quality gates uitbreiden
- [x] Fase 3: shared package mirrors uitfaseren
- [x] Fase 4: license service modulariseren
  - Eerste slice afgerond: runtime-config, tijdhelpers en license/tenant record-shaping zijn uit `server.js` gehaald.
  - Tweede slice afgerond: OAuth/protocolhelpers zijn uit `server.js` gehaald naar `src/lib/oauth.js`.
  - Derde slice afgerond: cookie-, redirect- en request-security helpers zijn uit `server.js` gehaald naar `src/lib/http.js`.
  - Vierde slice afgerond: billing/readiness helpers en Stripe mode-validatie zijn uit `server.js` gehaald naar `src/services/billing.js`.
  - Vijfde slice afgerond: account/email/wachtwoordhelpers en account-payload shaping zijn uit `server.js` gehaald naar `src/domain/accounts.js`.
  - Zesde slice afgerond: account lookup- en sessiehelpers zijn uit `server.js` gehaald naar `src/services/account-sessions.js`.
  - Zevende slice afgerond: publieke UI/static handlers en dashboard routecluster zijn uit `server.js` gehaald naar `src/routes/public-ui.js` en `src/routes/dashboard.js`.
  - Achtste slice afgerond: account-, license/billing-, admin- en OAuth-routes draaien nu via `src/routes/account.js`, `src/routes/license-billing.js`, `src/routes/admin.js` en `src/routes/oauth.js`; de dubbele OAuth-implementatie is uit `server.js` verwijderd.
- [x] Fase 5: theme file laag migreren naar GraphQL
  - Eerste slice afgerond: `src/lib/themeFiles.js` gebruikt nu Admin GraphQL theme management als primaire pad voor list/read/write/delete.
  - Tweede slice afgerond: checksum-based conflictchecks lopen nu ook via GraphQL; REST blijft alleen compat-fallback voor shops zonder GraphQL-ondersteuning.
- [x] Fase 6: section-systeem vervangen door blueprint-aanpak
  - Eerste slice afgerond: ondersteunde archetypes staan nu als expliciete blueprint-catalogus in code (`SUPPORTED_SECTION_BLUEPRINTS`) in plaats van verspreide detectie- en selectorblokken.
  - Tweede slice afgerond: gegenereerde section CSS/JS wordt inline opgenomen via `{% stylesheet %}` en `{% javascript %}`; er worden geen losse `assets/section-*.css/js` meer geschreven.
  - Derde slice afgerond: theme editor lifecycle hooks zijn uitgebreid met `shopify:section:unload` en `shopify:block:select`.
  - Vierde slice afgerond: na writes doet de pipeline voor main themes een echte storefront section rendercheck via Shopify's Section Rendering API en rolt writes terug bij render-fail.
- [x] Fase 7: resterende legacy definitief saneren
  - Eerste slice afgerond: `apps/hazify-license-service/server.js` compat-shim verwijderd; tests importeren nu direct `src/server.js`.
  - Tweede slice afgerond: `check:repo` blokkeert herintroductie van de verwijderde compat-shim.
  - Derde slice afgerond: archiefindex bijgewerkt zodat bewust bewaard legacy-materiaal volledig beschreven blijft.

## Actuele focus
De grote cleanupfases zijn functioneel afgerond. De resterende aandacht zit nu niet meer in repo-opruiming, maar in normale productdoorontwikkeling en optionele live-uitrol van de apart beheerde license-service.

## Open risico's
- Theme file management is nu GraphQL-primary; REST Asset API blijft alleen compat-fallback voor shops zonder ondersteunde theme GraphQL.
- Root `build` en `test` moeten nog steeds sequentieel gevalideerd worden in cleanupwerk; de grootste gedeelde-state oorzaak is weg, maar deploy- en smokechecks blijven expliciet.
- Repo-root Railway beheer voor de license service werkt nu via expliciete link-wissel (`npm run railway:link:license`); de standaard link blijft bewust `Hazify-MCP-Remote`.

## Post-cleanup uitvoering
- [x] Commitserie opsplitsen per cleanupfase
- [x] Repo-root Railway beheerpad voor `Hazify-License-Service` voorbereiden en valideren
- [x] Release notes per cleanupcommit vastgelegd
- [x] `check:git-sync` uitgevoerd; push blijft operationeel geblokkeerd op GitHub `workflow` permissie

## Changelog
- 2026-03-10: cleanup PR-plan toegevoegd.
- 2026-03-10: actieve tracker toegevoegd.
- 2026-03-10: docs-index en leesvolgorde uitgebreid met cleanupdocs.
- 2026-03-10: afgeronde UI/UX-tracker gearchiveerd.
- 2026-03-10: ongebruikte docs-assets verwijderd.
- 2026-03-10: root README en service-README's verder uitgelijnd met runtime.
- 2026-03-10: CI install-stap aangescherpt naar `npm ci`.
- 2026-03-10: losse `apps/hazify-mcp-remote/USAGE.md` verwijderd en samengevoegd in de service-README.
- 2026-03-10: section-docs verduidelijkt naar begrensde, preview-based replicatie.
- 2026-03-10: `check:docs` toegevoegd voor docs-index, leesvolgorde en lokale markdown-link validatie.
- 2026-03-10: `check:repo` toegevoegd voor vereiste mappen, legacy root-mappen en junkbestanden.
- 2026-03-10: CI uitgebreid met docs- en repo-hygiëne checks.
- 2026-03-10: junkbestanden `.DS_Store` verwijderd zodat de nieuwe repo-hygiëne gate direct schoon start.
- 2026-03-10: mirror-strategie opnieuw gevalideerd; uitfaseren blijft aparte slice omdat app-packages nog op `file:./packages/*` leunen.
- 2026-03-10: Railway buildlogs en live containerinspectie bevestigd dat `Hazify-MCP-Remote` eerst nog niet vanaf repo-root maar als geïsoleerde app-build draaide.
- 2026-03-10: eerste license-service modularisatieslice doorgevoerd via `src/config/runtime.js`, `src/lib/time.js` en `src/domain/license-records.js`.
- 2026-03-10: tweede license-service modularisatieslice doorgevoerd via `src/lib/oauth.js` en extra pure OAuth-helpertests.
- 2026-03-10: derde license-service modularisatieslice doorgevoerd via `src/lib/http.js` en extra pure HTTP-helpertests.
- 2026-03-10: vierde license-service modularisatieslice doorgevoerd via `src/services/billing.js`, inclusief pure billing/readiness tests en verwijderde checkout-helperduplicatie.
- 2026-03-10: vijfde license-service modularisatieslice doorgevoerd via `src/domain/accounts.js`, inclusief pure account/email/password tests.
- 2026-03-10: parallelle root-validatie bevestigde opnieuw dat `build` en `test` nog niet tegelijk veilig zijn door de actieve shared package mirrors; sequentiële validatie blijft vereist tot PR-3.
- 2026-03-10: eerste themeslice doorgevoerd: `src/lib/themeFiles.js` gebruikt nu Admin GraphQL voor theme list/read/write/delete, met REST-fallback voor checksum-writes en shops zonder GraphQL-ondersteuning.
- 2026-03-10: zesde license-service modularisatieslice doorgevoerd via `src/services/account-sessions.js`, inclusief pure account session tests.
- 2026-03-10: Railway productie-deploy voor `Hazify-MCP-Remote` succesvol uitgerold vanuit `apps/hazify-mcp-remote/`; repo-root deploy faalt nog op ontbrekend startcommand en bevestigt de app-root constraint van Fase 3.
- 2026-03-10: root `start` toegevoegd voor de MCP-service; repo-root Railway deploy is daarna succesvol gevalideerd in environment `cleanup-root-deploy`.
- 2026-03-10: Railway productie-deploy succesvol gemigreerd naar repo-root via deployment `b0f497e2-0fb8-45bf-aebd-3322820661fa`.
- 2026-03-10: app-package dependencies omgezet naar `../../packages/*`; `sync:shared` en `verify:shared` verwijderd; `apps/*/packages/*` verwijderd en via `check:repo` verboden gemaakt.
- 2026-03-10: mirrorvrije MCP-productiedeploy succesvol uitgerold via deployment `e19eba1c-efc9-4cae-b2b5-541cc8b572eb`.
- 2026-03-10: productie-smokecheck geslaagd na de mirrorverwijdering.
- 2026-03-10: zevende license-service modularisatieslice doorgevoerd via `src/routes/public-ui.js` en `src/routes/dashboard.js`; alle bestaande root-checks en tests bleven groen.
- 2026-03-10: achtste license-service modularisatieslice doorgevoerd via `src/routes/account.js`, `src/routes/license-billing.js`, `src/routes/admin.js` en `src/routes/oauth.js`; de oude OAuth-handlers zijn uit `server.js` verwijderd en de route-registratie gebruikt nu uitsluitend de modulehandlers.
- 2026-03-10: tweede themeslice doorgevoerd: checksum-based writes gebruiken nu eerst GraphQL checksum-validatie en vallen alleen nog terug op REST wanneer Shopify theme GraphQL niet beschikbaar is.
- 2026-03-10: MCP runtime-default omgezet van `stdio` naar `http`; documentatie en productiegedrag zijn daardoor weer consistent, terwijl `stdio` als expliciete fallback behouden blijft.
- 2026-03-10: eerste Fase 6-slice doorgevoerd: de section-replicator gebruikt nu een expliciete blueprint-catalogus (`SUPPORTED_SECTION_BLUEPRINTS`) voor archetype-detectie, bundle-selectie en target selectors.
- 2026-03-10: tweede Fase 6-slice doorgevoerd: gegenereerde section CSS/JS wordt inline geschreven via `{% stylesheet %}` en `{% javascript %}` in plaats van losse theme assets.
- 2026-03-10: derde Fase 6-slice doorgevoerd: section runtime hooks ondersteunen nu ook `shopify:section:unload` en `shopify:block:select`.
- 2026-03-10: vierde Fase 6-slice doorgevoerd: na writes verifieert de pipeline op main themes een echte storefront section render via `section_id`, en rolt writes terug bij render-fail.
- 2026-03-10: nieuwste MCP cleanup live uitgerold via Railway deployment `c99ffcaf-9474-4ee6-98c5-f962ab8a6051`.
- 2026-03-10: productie-smokecheck opnieuw geslaagd na deployment `c99ffcaf-9474-4ee6-98c5-f962ab8a6051`.
- 2026-03-10: Fase 7 cleanup afgerond: `apps/hazify-license-service/server.js` compat-shim verwijderd, tests wijzen direct naar `src/server.js` en `check:repo` blokkeert herintroductie van de shim.
- 2026-03-10: Fase 6 afgerond met storefront theme-context renderchecks via Shopify's `section_id` renderpad en rollback bij render-fail.
- 2026-03-10: MCP productiedeploy `cc78a46e-623a-417e-b26f-b1c4a004ffcf` succesvol uitgerold; `npm run smoke:prod` bleef groen na de rollout.
- 2026-03-10: repo-root service-router toegevoegd via `HAZIFY_SERVICE_MODE`, plus `railway:link:mcp` en `railway:link:license` voor expliciete projectwissel.
- 2026-03-10: `Hazify-License-Service` repo-root deploy succesvol gevalideerd via deployment `85d9c4f7-eb9d-4761-a29c-44b60483edb2`.
- 2026-03-10: `Hazify-MCP-Remote` repo-root deploy opnieuw bevestigd via deployment `9225c0ab-98d4-472a-a754-8684e7569b3a`.
- 2026-03-10: release notes vastgelegd in `docs/52-CLEANUP-RELEASE-NOTES.md`.
- 2026-03-10: `npm run check:git-sync` bevestigde `ahead=3`, `behind=0`; automatische push-dry-run blijft geblokkeerd zolang workflow-permissie ontbreekt.

## Fase 2 detail
- [x] `npm ci` staat in CI
- [x] docs-index en leesvolgorde worden geverifieerd
- [x] lokale markdown-links in actieve docs worden gevalideerd
- [x] repo-junk en verboden root-mappen worden geblokkeerd
- [x] deeper unused-scan gesloten na handmatige repo-audit en verwijdering van bevestigde mirrors, compat-shims, docs-ruis en legacy-bestanden; een generieke unused-export scan zou hier nog te veel false positives geven door dynamische MCP-toolregistratie.
- [x] theme-validatie afgedekt via `toolHardening.test.mjs`, GraphQL-primary theme adapters en storefront Section Rendering verificatie in de replicatiepipeline; een aparte theme fixture-validator is daardoor geen cleanup-blocker meer.

## Fase 3 status
- [x] App-package dependencymodel en lockfile in kaart gebracht
- [x] Railway buildmodel gevalideerd op de live MCP service
- [x] Bevestigd dat productie eerst nog via app-root (`apps/hazify-mcp-remote/`) liep
- [x] Repo-root deploypad technisch gevalideerd in aparte Railway environment
- [x] Productie gecontroleerd migreren van app-root naar repo-root
- [x] Daarna `apps/*/packages/*` uitfaseren

## Eindstatus
- [x] Cleanup-plan vastgelegd en bijgehouden
- [x] Docs en repo-structuur uitgelijnd
- [x] CI en repo-hygiëne aangescherpt
- [x] Shared package mirrors verwijderd
- [x] License service gemoduleerd
- [x] Theme file adapter gemigreerd naar GraphQL-primary
- [x] Section pipeline begrensd en voorzien van storefront render-validatie
- [x] Laatste compat-shims en archiefdrift opgeschoond
