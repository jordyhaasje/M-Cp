# Remediation Plan
Doelgroep: maintainers, developers en coding agents.

Versie: 2026-04-22.
Status: actief voortgangsdocument voor de lopende remediation na de MCP-audit.

## Doel
Dit document volgt de open remediation-tracks, release-gates en live-validatie. `docs/04-MCP-REMOTE-AUDIT.md` blijft de canonieke auditbron; dit bestand is het werkbord.

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
| Protocolcorrectheid MCP-errors | MCP maintainers | Afgerond | Ja | Ja | Na commit | `Hazify-MCP-Remote` na push | Ja | Nee | 2026-04-22 | `success: false` zet nu `isError: true`; live Railway draait nog niet op deze lokale stand. |
| Strikt theme-targeting | MCP maintainers | Afgerond | Ja | Ja | Na commit | `Hazify-MCP-Remote` na push | Ja | Nee | 2026-04-22 | Geen stille `main`-fallback meer; sticky target alleen na expliciete eerdere keuze. |
| Liquid template placement in edit-flow | MCP maintainers | Afgerond | Ja | Ja | Na commit | `Hazify-MCP-Remote` na push | Ja | Nee | 2026-04-22 | `draft-theme-artifact` accepteert nu ook `templates/*.liquid` naast `templates/*.json`. |
| Snippet/native-block parity | MCP maintainers | Afgerond lokaal | Ja | Ja | Na commit | `Hazify-MCP-Remote` na push | Ja | Nee | 2026-04-22 | `plannerHandoff` draagt nu architecture mee; snippet-validatie checkt gerelateerd schema, onveilige optionele block-media, `@theme` routes en laat Shopify-conforme `@app`-schema entries ongemoeid. |
| Cross-theme acceptatiematrix | MCP maintainers | Afgerond lokaal | Ja | Ja | Na commit | `Hazify-MCP-Remote` na push | Ja | Nee | 2026-04-22 | Vier archetypes + prompt-only create, screenshot-only exact create, image-backed exact create, existing edit, native-block write/preview en template placement zijn lokaal groen. |
| Non-theme contract cleanup | MCP maintainers | Afgerond | Ja | Ja | Na commit | `Hazify-MCP-Remote` na push | Ja | Nee | 2026-04-22 | Refund idempotency, product-contract cleanup, tracking redirects en auditsporen lokaal groen. |
| License-service/Railway hardening | License maintainers | Afgerond | Ja | Ja | Na commit | `Hazify-License-Service` na push | Ja | Nee | 2026-04-22 | Productieherkenning, env-validatie, persist-herstel en backup-policy lokaal groen. |
| Docs/runbook waarheid | Maintainers | In uitvoering | Deels | Ja | Na commit | Geen code-based redeploy | Nee | N.v.t. | 2026-04-22 | Releasepolicy, impactmatrix en audit/live truth worden nu expliciet bijgehouden. |

## Laatste lokale verificatie
- `npm run release:status`
- `npm run release:preflight`
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- Shopify Dev MCP `validate_theme` op een representatieve tijdelijke OS 2.0 theme-fixture (`sections/exact-reference.liquid`, `sections/main-product.liquid`, `snippets/product-info.liquid`)
- Shopify Dev MCP `validate_theme` op een representatieve tijdelijke native-block fixture (`sections/main-product.liquid`, `snippets/product-info.liquid`, `blocks/review-badge.liquid`)

## Laatste live Railway waarheid
| Service | Laatste gecontroleerde success-deploy | Status live bevestigd |
| --- | --- | --- |
| `Hazify-MCP-Remote` | `a220e440-5f9c-43c9-9e77-25e6aa4b407f` op 2026-04-21 | Nee, huidige lokale remediation is nieuwer |
| `Hazify-License-Service` | `61cc2fa6-9c98-41a2-8634-7eec84a93303` op 2026-04-19 | Nee, huidige lokale remediation is nieuwer |

## Eerstvolgende gates
1. Draai `npm run release:status` en bevestig dat de commit scope nog steeds beide runtime services raakt.
2. Draai `npm run release:preflight` op de definitieve commit-kandidaat.
3. Commit de bedoelde runtime/docs-wijzigingen.
4. Push naar `origin/main`.
5. Wacht op de code-based Railway deploys voor `Hazify-MCP-Remote` en `Hazify-License-Service`, of forceer alleen een handmatige redeploy als GitHub auto-deploy niet afgaat.
6. Draai `npm run release:postdeploy`.
7. Controleer Railway deployment metadata en logs en zet daarna pas `Live bevestigd` op `Ja`.

## Documentatie-afspraak
- Audit = canonieke bron voor status, blockers en acceptatiecriteria.
- Dit plan = canonieke bron voor voortgang, release-gates en live confirmatie.
- Tracker in `docs/archive/` = historisch referentiemateriaal.
- `scripts/generate-tool-docs.mjs` auto-synct alleen de toolcatalogus in `AGENTS.md` en `docs/02-SYSTEM-FLOW.md`; alle overige docs blijven handmatig.
