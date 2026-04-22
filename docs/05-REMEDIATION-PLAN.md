# Remediation Plan
Doelgroep: maintainers, developers en coding agents.

Versie: 2026-04-22.
Status: actief voortgangs- en release-document na de remediation-tranche van 2026-04-22.

## Doel
Dit document volgt de actuele release-gates, live-validatie en resterende onderhoudstracks. `docs/04-MCP-REMOTE-AUDIT.md` blijft de canonieke auditbron; dit bestand is het werkbord en de release-log.

## Releasepolicy
- Gebruik altijd eerst `npm run release:status` om te bepalen of er nog een lokale commit nodig is, of er nog een push openstaat en welke Railway service(s) na push een redeploy nodig hebben.
- Gebruik `npm run release:preflight` voor volledige lokale verificatie zodra runtime-code, mirrored packages of meerdere workspaces geraakt zijn.
- Code-based Railway deploys gebeuren pas ná commit en push. Uitzondering: env-only Railway wijzigingen; die moeten alsnog in dit document gelogd worden.
- `npm run smoke:prod` is een post-deploy check op live Railway URLs en telt dus niet als pre-deploy bewijs.
- Live bevestigd betekent pas: deploy geslaagd, smoke groen, Railway logs nagekeken, en geen nieuw terugkerend foutpatroon.

## Redeploy-matrix
| Wijzigingsscope | Commit nodig | Push nodig | Railway redeploy |
| --- | --- | --- | --- |
| `apps/hazify-mcp-remote/src/**`, `apps/hazify-mcp-remote/packages/**`, `apps/hazify-mcp-remote/package.json` | Ja | Ja | `Hazify-MCP-Remote` |
| `apps/hazify-license-service/src/**`, `apps/hazify-license-service/packages/**`, `apps/hazify-license-service/package.json` | Ja | Ja | `Hazify-License-Service` |
| `packages/**`, root `package.json`, root `package-lock.json` | Ja | Ja | Meestal beide services |
| `docs/**`, `AGENTS.md`, test-only wijzigingen | Ja als je ze wilt bewaren | Alleen als commit ahead staat | Geen code-based redeploy |
| Railway env-only wijziging | Nee | Niet per se | Redeploy van de getroffen service, plus smoke/logreview |

## Werkstroombord
| Track | Owner | Status | Lokaal gereed | Commit nodig | Push nodig | Redeploy nodig | Post-deploy smoke nodig | Live bevestigd | Laatste verificatie | Opmerking |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Protocolcorrectheid MCP-errors | MCP maintainers | Afgerond | Ja | Nee | Nee | Nee | Nee | Ja | 2026-04-22 | Live bevestigd op `Hazify-MCP-Remote` deployment `a114fabe-96fd-4a64-9b47-03f6d2bf3045` plus groene post-deploy smoke. |
| Strikt theme-targeting | MCP maintainers | Afgerond | Ja | Nee | Nee | Nee | Nee | Ja | 2026-04-22 | Geen stille `main`-fallback meer; sticky target alleen na expliciete eerdere keuze; live smoke is groen. |
| Liquid template placement in edit-flow | MCP maintainers | Afgerond | Ja | Nee | Nee | Nee | Nee | Ja | 2026-04-22 | `draft-theme-artifact` accepteert nu ook `templates/*.liquid` naast `templates/*.json`; current live runtime is bevestigd. |
| Snippet/native-block parity | MCP maintainers | Afgerond | Ja | Nee | Nee | Nee | Nee | Ja | 2026-04-22 | `plannerHandoff` draagt nu architecture mee; snippet-validatie checkt gerelateerd schema, onveilige optionele block-media, `@theme` routes en laat Shopify-conforme `@app`-schema entries ongemoeid. |
| Cross-theme acceptatiematrix | MCP maintainers | Afgerond | Ja | Nee | Nee | Nee | Nee | Ja | 2026-04-22 | Vier archetypes + prompt-only create, screenshot-only exact create, image-backed exact create, existing edit, native-block write/preview en template placement zijn lokaal groen; live runtime draait op de gevalideerde code. |
| Non-theme contract cleanup | MCP maintainers | Afgerond | Ja | Nee | Nee | Nee | Nee | Ja | 2026-04-22 | Refund idempotency, product-contract cleanup, tracking redirects en auditsporen zijn live bevestigd op de huidige MCP deploy. |
| License-service/Railway hardening | License maintainers | Afgerond | Ja | Nee | Nee | Nee | Nee | Ja | 2026-04-22 | Railway-crash op ontbrekende `BACKUP_EXPORT_*` startup-validatie is opgelost in commit `07d9e66` en live bevestigd op deployment `b9c84b4e-9aa5-48dc-973b-f1c157b00146`. |
| Docs/runbook waarheid | Maintainers | Afgerond | Ja | Nee | Nee | Nee | Nee | N.v.t. | 2026-04-22 | Audit/live truth en releasepolicy zijn bijgewerkt; resterende docs-drift blijft een handmatige onderhoudstrack. |

## Laatste lokale verificatie
- `npm run release:status`
- `npm run release:preflight`
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- Shopify Dev MCP `validate_theme` op een representatieve tijdelijke OS 2.0 theme-fixture (`sections/exact-reference.liquid`, `sections/main-product.liquid`, `snippets/product-info.liquid`)
- Shopify Dev MCP `validate_theme` op een representatieve tijdelijke native-block fixture (`sections/main-product.liquid`, `snippets/product-info.liquid`, `blocks/review-badge.liquid`)

## Laatste live verificatie
- Railway deploy `Hazify-MCP-Remote`: `a114fabe-96fd-4a64-9b47-03f6d2bf3045` (`SUCCESS`)
- Railway deploy `Hazify-License-Service`: `b9c84b4e-9aa5-48dc-973b-f1c157b00146` (`SUCCESS`)
- Railway deploy logs gecontroleerd: MCP start op `0.0.0.0:8080`; license-service start met `Storage: PostgreSQL (DATABASE_URL)` zonder backup-export startup crash.
- `npm run release:postdeploy` groen op 2026-04-22
- Optionele live-checks eerlijk overgeslagen in dezelfde smoke-run: `/v1/admin/readiness` zonder lokale `ADMIN_API_KEY`, `/v1/billing/readiness` zonder lokale billing envs.

## Laatste live Railway waarheid
| Service | Laatste gecontroleerde success-deploy | Status live bevestigd |
| --- | --- | --- |
| `Hazify-MCP-Remote` | `a114fabe-96fd-4a64-9b47-03f6d2bf3045` op 2026-04-22 | Ja |
| `Hazify-License-Service` | `b9c84b4e-9aa5-48dc-973b-f1c157b00146` op 2026-04-22 | Ja |

## Eerstvolgende gates
1. Blijf `npm run release:status` gebruiken als beslisser voor de volgende runtime-tranche: commit eerst, daarna pas push en Railway redeploy.
2. Pak de handmatige docs-drift-track verder aan buiten `AGENTS.md` en `docs/02-SYSTEM-FLOW.md`.
3. Evalueer de niet-blokkerende Railway warnings (`npm warn config production`, `punycode`) als aparte hygiene-tranche.
4. Voeg desgewenst nog een authenticated production MCP smoke toe als extra bewijslaag.

## Documentatie-afspraak
- Audit = canonieke bron voor status, blockers en acceptatiecriteria.
- Dit plan = canonieke bron voor voortgang, release-gates en live confirmatie.
- `scripts/generate-tool-docs.mjs` auto-synct alleen de toolcatalogus in `AGENTS.md` en `docs/02-SYSTEM-FLOW.md`; alle overige docs blijven handmatig.
