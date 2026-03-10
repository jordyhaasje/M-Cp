# Cleanup Release Notes

Datum: 2026-03-10

## Commit 1
Commit: `d1b565c`
Titel: `chore(repo): add cleanup guardrails and tracking`

Inhoud:
- cleanup PR-plan en actieve tracker toegevoegd
- docs-index en verplichte leesvolgorde bijgewerkt
- docs- en repo-hygiënechecks toegevoegd
- overbodige docs-assets en losse usage-doc verwijderd of gearchiveerd
- repo-root service-router voorbereid via `scripts/start-service.mjs`

Impact:
- geen runtimecontractwijziging voor `/mcp` of OAuth
- repo en documentatie zijn nu expliciet bewaakt

## Commit 2
Commit: `4c18022`
Titel: `refactor(platform): remove mirrors and modularize license service`

Inhoud:
- `apps/*/packages/*` mirrors verwijderd
- lockfile en package-referenties teruggebracht naar root packages
- license service opgesplitst in `config`, `domain`, `lib`, `routes` en `services`
- laatste `apps/hazify-license-service/server.js` compat-shim verwijderd
- pure tests toegevoegd voor account-, billing-, OAuth-, HTTP- en licensehelpers

Impact:
- repo heeft nog maar één bron van waarheid voor gedeelde packages
- license service is onderhoudbaar zonder endpointbreuk

## Commit 3
Commit: `28fb8fd`
Titel: `refactor(mcp): harden theme tooling and repo-root deploy flows`

Inhoud:
- theme file management is GraphQL-primary, inclusief checksum-safe writes
- section replication gebruikt expliciete blueprints
- gegenereerde sections schrijven inline `{% stylesheet %}` en `{% javascript %}`
- section runtime ondersteunt editor lifecycle hooks
- na writes volgt storefront render-validatie via Shopify `section_id`
- bij render-fail doet de pipeline rollback
- repo-root deploypad werkt nu voor zowel MCP als license service via `HAZIFY_SERVICE_MODE`
- Railway linkscripts toegevoegd voor expliciete projectwissel

Impact:
- MCP section tooling is begrensd, verifieerbaar en veiliger
- beide Railway-projecten zijn vanaf repo-root te beheren

## Live validatie
- `Hazify-License-Service` repo-root deploy gevalideerd: `85d9c4f7-eb9d-4761-a29c-44b60483edb2`
- `Hazify-MCP-Remote` repo-root deploy gevalideerd: `9225c0ab-98d4-472a-a754-8684e7569b3a`
- `npm run smoke:prod` bleef groen na beide deploys

## Push-voorbereiding
- `npm run check:git-sync` resultaat: branch staat `ahead=3`, `behind=0`
- automatische push-dry-run is bewust geblokkeerd omdat `.github/workflows/ci.yml` in de nieuwe commits is gewijzigd
- voor push is een GitHub token of sleutel nodig met `workflow` permissie

## Aanbevolen push-volgorde
1. Verifieer GitHub-auth met workflow-scope
2. Draai `npm run check:git-sync` opnieuw
3. Push `main` naar `origin/main`
