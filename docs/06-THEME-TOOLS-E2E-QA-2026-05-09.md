# Theme Tools E2E QA - 2026-05-09
Doelgroep: ontwikkelaars, QA-maintainers en coding agents.

## Context
Doel: Hazify MCP theme tools moeten Shopify Online Store 2.0 theme code kunnen lezen, maken, namaken, aanpassen en valideren voor elk OS 2.0 theme, zonder theme-specifieke hardcoding.

Getest theme: live Impact theme `187324891450` (`Shopify-impact--theme/main`).

Referenties:
- `https://section.store/pages/feature-54`
- `https://section.store/pages/slider-7`
- Lokale screenshots: `/Users/jordy/Desktop/feature-54.png` en `/Users/jordy/Desktop/Slider 7.png`

## Uitgevoerde Testen
- Theme discovery via `get-themes`.
- Planning via `plan-theme-edit`.
- Exacte reads via `get-theme-file`, `get-theme-files` en alias `read-theme-file`.
- Nieuwe section writes via `create-theme-section`.
- Bestaande section edit via `patch-theme-file` en fallback `draft-theme-artifact mode="edit"`.
- Write verificatie via create/draft verify-output en metadata-readback.
- `verify-theme-files` metadata getest; schema-exposure bleek defect.

## Live Theme Resultaten
Gemaakt en geverifieerd:
- `sections/hazify-test-slider.liquid`
- `sections/hazify-test-hero.liquid`

Geblokkeerd door validator:
- `sections/hazify-test-faq.liquid`
- `sections/hazify-test-feature-54.liquid`
- `sections/hazify-test-slider-7.liquid`

Belangrijk: FAQ, feature-54 en Slider 7 werden niet geblokkeerd door destructieve risico's, maar door een portability-conflict. De validator eiste Impact-snippets (`section-spacing-collapsing` / `section-properties`) terwijl de test juist generieke, theme-onafhankelijke OS 2.0 sections moest opleveren.

## Bugtracker
| ID | Status | Bevinding | Fixrichting |
| --- | --- | --- | --- |
| THEME-QA-001 | Gefixt, lokaal gevalideerd | Impact-like theme context blokkeert portable sections zonder Impact wrappers. | Wrapper-conventie is warning/advies geworden, geen blocking error, zolang CSS gescoped is. |
| THEME-QA-002 | Gefixt, lokaal gevalideerd | `patch-theme-file` kan sticky memory combineren met expliciete target en zo tegelijk `themeId` en `themeRole` naar `draft-theme-artifact` sturen. | Sticky target wordt alleen hergebruikt als er geen expliciet target is; downstream krijgt exact een van beide. |
| THEME-QA-003 | Gefixt, lokaal gevalideerd | `verify-theme-files` wordt in MCP schema als no-args exposed door Zod effects/superRefine. | Public input schema is gescheiden van runtime validation schema. |
| THEME-QA-004 | Gefixt, lokaal gevalideerd | Prompt parsing behandelt negaties als requirements, bijvoorbeeld "no images" of "geen slider". | Negated feature phrases worden gestript voor intent/coverage detectie. |
| THEME-QA-005 | Gefixt, lokaal gevalideerd | Image prompt coverage wordt `partial` wanneer image rendering via een assigned Liquid variable loopt. | Assigned image variables tellen nu als render path naar `image_url`/`image_tag`. |
| THEME-QA-006 | Gefixt, lokaal gevalideerd | `verbosity="compact"` kan nog steeds grote `themeContext`, `sectionBlueprint`, `plannerHandoff` en `codegenContract` payloads teruggeven op success. | Success responses volgen nu dezelfde debug-payload policy als failure responses. |
| THEME-QA-007 | Gefixt, lokaal gevalideerd | Replica-schaal check classificeert title font-size soms als body font-size door container-class zoals `__copy h3`. | Body-font selector is minder breed zodat heading/card-title niet als body wordt gemeten. |

## Fixplan
1. Portability: Impact wrappers niet meer verplichten voor nieuwe generieke sections; alleen scoped CSS blijft hard requirement.
2. Targeting: patch-flow target-normalisatie exclusief maken.
3. Tool schema: `verify-theme-files` public schema herstel.
4. Codegen contract: negatie- en image-renderdetectie verbeteren.
5. Responses: compact success payloads echt compact maken.
6. Tests: regressietests toevoegen/aanpassen voor bovenstaande bugs.
7. Re-test: na lokale tests opnieuw live theme tool-flow testen op Impact zonder theme-specifieke snippets.

## Lokale Validatie Na Fixes
- Command: `npm --prefix apps/hazify-mcp-remote test -- --runInBand tests/draftThemeArtifact.test.mjs tests/themeCodegenContract.test.mjs tests/toolHardening.test.mjs tests/toolRegistry.test.mjs`
- Resultaat: pass. De runner voerde breder uit dan de opgegeven files en eindigde met `All hazify tests passed`.
- Belangrijke regressies afgedekt: portable Impact sections zonder wrappers, exclusieve theme target-forwarding in patch-flow, `verify-theme-files` public input schema, negated prompt features, assigned image variables, compacte success payloads en body-font schaalclassificatie.

## Open Re-test
- Live MCP runtime opnieuw getest op theme `187324891450`.
- `get-themes`: pass, live Impact theme bevestigd.
- `plan-theme-edit` voor portable FAQ: pass voor planning, maar de live runtime blijft Impact wrapper reads voorstellen.
- `get-theme-files`: pass voor exacte planner reads.
- `create-theme-section` voor `sections/hazify-regression-faq.liquid`: blocked, geen write uitgevoerd (`liveFileUnchanged=true`, readback `NOT_FOUND`). De live runtime blokkeert nog steeds met `inspection_failed_impact_wrapper`.
- `verify-theme-files`: execute pass met expliciete args op `sections/hazify-test-slider.liquid`, maar de MCP metadata toont deze tool nog als no-args; schema-exposure blijft live een client-UX bug totdat de gefixte runtime actief is.
- `patch-theme-file` non-mutating repair-test: pass voor exclusieve target-normalisatie; `nextArgsTemplate` bevatte alleen `themeId`, geen dubbele `themeRole`.
- `plan-theme-edit` negatie-test met "No images, no slider": fail in live runtime; `sectionContract.requiredFeatures` bevatte nog `slides` en `images`.

Conclusie hertest: de lokale fixes zijn gevalideerd, maar de verbonden/live Hazify MCP runtime draait nog niet volledig met deze wijzigingen. Er zijn geen extra theme files geschreven tijdens deze hertest.

## Release Validatie
- `npm run release:preflight`: pass.
- `npm --prefix apps/hazify-mcp-remote test`: pass, `All hazify tests passed`.
- `npm run check:docs`: pass.
- `npm run build`: pass.
- `npm run check:repo`: pass.
- `npm run test:e2e`: pass.
- Shopify Dev MCP `learn_shopify_api(api="liquid")`: pass; officiële Liquid/theme-context geladen.
- Shopify Dev MCP `validate_theme`: pass op een representatieve portable FAQ section met native `<details>/<summary>`, block settings, `{{ block.shopify_attributes }}` en scoped CSS. Artifact: `artifact-f0e68c02-feab-47b0-840b-74687e200300`, revision 1.
- Context7 MCP: blocked door connector-auth (`token_invalidated`). Geen repo-blocker, maar wel een tooling-issue voor externe docverificatie.
- Railway MCP status: pass; Railway CLI is geïnstalleerd en geauthenticeerd. Gekoppelde service: `Hazify-MCP-Remote`.

## Doelstatus
Lokaal en in de gedeployde code is het hoofddoel technisch haalbaar gemaakt voor de geteste regressies: de MCP-server kan portable Online Store 2.0 sections valideren zonder theme-specifieke Impact hardcoding, prompt-negaties correct interpreteren, image-renderpaden via Liquid variables herkennen, compacte responses geven en theme targets veiliger doorgeven.

Production smoke is groen na deploy, maar de store-gekoppelde Codex/Hazify appconnector gaf daarna `token_invalidated`. Daardoor is de post-deploy live store hertest nog niet volledig bewezen met echte store data. Zodra de connector opnieuw is geauthenticeerd, moet opnieuw worden gecontroleerd:
- portable FAQ create zonder Impact wrappers;
- `feature-54` replica create zonder verplichte Impact wrappers;
- `Slider 7` replica create zonder verplichte Impact wrappers;
- `plan-theme-edit` met "No images, no slider" zonder foutieve `slides`/`images` requirements;
- MCP metadata voor `verify-theme-files` met zichtbaar `expected[]` input schema.

## Deploy Status
- Commit: `931a8a4 fix: harden portable theme section workflows`.
- Push: `origin/main` bijgewerkt.
- Railway service: `Hazify-MCP-Remote`.
- Deployment: `55dce8e6-fc89-47a2-965b-0dce630d6b9a`.
- Deployment status: `SUCCESS`.
- Post-deploy smoke: pass via `npm run release:postdeploy`.
- Railway deploy logs filter `error OR warn`: leeg.
- Live MCP appconnector hertest na deploy: blocked door connector-auth `token_invalidated`; er zijn daardoor geen extra live theme files geschreven na de redeploy.
