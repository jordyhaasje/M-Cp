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
| THEME-QA-008 | Gefixt, lokaal gevalideerd | Compacte `plan-theme-edit` output gaf geen bruikbare handoff terug, waardoor stateless LLM-clients de plannerbrief en replica-context kwijtraakten tussen plan en create. | Compacte output bevat nu een compacte `plannerHandoff` met brief, target, reads, referenceSignals en codegenContract. |
| THEME-QA-009 | Gefixt, lokaal gevalideerd | Screenshot-/URL-analyse kon alleen als vrije summary meelopen en werd daardoor te makkelijk genegeerd of overschreven door compacte toolinputs. | `plan-theme-edit`, `create-theme-section` en `draft-theme-artifact` accepteren nu `visualBrief`, `referenceAnalysis` en `designBrief`. |
| THEME-QA-010 | Gefixt, lokaal gevalideerd | Directe `draft-theme-artifact mode="create"` calls zonder plannercontext vielen terug naar te lichte validatie, waardoor minimale of visueel incomplete sections konden slagen. | Directe create-writes gebruiken nu `production_visual` als backstop met scoped CSS, responsive, carousel-control en Theme Editor lifecycle checks. |
| THEME-QA-011 | Gefixt, lokaal gevalideerd | `feature-54` en `Slider 7` replica's werden niet als eigen visuele contracten herkend; generieke feature/slider-baselines konden de specifieke referentie-anchors missen. | Nieuwe `feature_media_list` archetype plus feature-54/Slider-7 prompt coverage: grote media, icon rows, counter, active slide contrast, peek cards en zes preset slides. |
| THEME-QA-012 | Gefixt, lokaal gevalideerd | Hero/social-proof sections met geldige section-level review, reviewer, CTA en avatar renderpaden konden onterecht `prompt_coverage_partial` krijgen door brittle id-detectie en block-only contracts. | Feature coverage normaliseert snake/kebab/camel/spatievarianten en accepteert single-review hero settings; herhaalbare review cards vereisen pas review blocks wanneer de prompt dat semantisch vraagt. |
| THEME-QA-013 | Gefixt, lokaal gevalideerd | Moderne full-bleed hero sections konden falen op `section_recipe_wrapper_mode_mismatch` omdat `no_background_shell` een outer gradient/media shell blokkeerde. | Nieuw `own_media_shell` wrapper-mode staat full-bleed media/gradient roots toe en blokkeert alleen dubbele ownership via `section-properties` background/text-color. |
| THEME-QA-014 | Gefixt, lokaal gevalideerd | Een malformed of unclosed `{% schema %}` kon als `schema_missing_schema_block` terugkomen, wat retries richting de verkeerde fix stuurde. | Schema tag parsing normaliseert code fences/escaped tags en rapporteert unclosed/unopened/unbalanced schema blocks expliciet. |

## Fixplan
1. Portability: Impact wrappers niet meer verplichten voor nieuwe generieke sections; alleen scoped CSS blijft hard requirement.
2. Targeting: patch-flow target-normalisatie exclusief maken.
3. Tool schema: `verify-theme-files` public schema herstel.
4. Codegen contract: negatie- en image-renderdetectie verbeteren.
5. Responses: compact success payloads echt compact maken.
6. Generic create-section robustness: hero/social-proof datamodel, semantic feature coverage, full-bleed media shells en schema diagnostics generiek maken voor alle OS 2.0 themes.
7. Tests: regressietests toevoegen/aanpassen voor bovenstaande bugs.
8. Re-test: na lokale tests opnieuw live theme tool-flow testen op Impact zonder theme-specifieke snippets.

## Lokale Validatie Na Fixes
- Command: `npm --prefix apps/hazify-mcp-remote test -- --runInBand tests/draftThemeArtifact.test.mjs tests/themeCodegenContract.test.mjs tests/toolHardening.test.mjs tests/toolRegistry.test.mjs`
- Resultaat: pass. De runner voerde breder uit dan de opgegeven files en eindigde met `All hazify tests passed`.
- Belangrijke regressies afgedekt: portable Impact sections zonder wrappers, exclusieve theme target-forwarding in patch-flow, `verify-theme-files` public input schema, negated prompt features, assigned image variables, compacte success payloads en body-font schaalclassificatie.

## Vervolgvalidatie Context- en Replica-fixes
- Datum: 2026-05-09.
- Aanleiding: LLM-clients konden nog geen sections betrouwbaar maken of namaken omdat compact planner-contextverlies, vrije visual-summary velden en te lichte direct-create validatie nog open stonden.
- Command: `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs apps/hazify-mcp-remote/tests/themeCodegenContract.test.mjs apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- Resultaat: pass, `168` tests groen.
- Afgedekt: compact `plannerHandoff`, `visualBrief`/`referenceAnalysis` normalisatie, direct-create `production_visual` backstop, echte carousel-controls met Theme Editor lifecycle, `feature-54` feature/media-list anchors en `Slider 7` counter/peek/active-state anchors.

## Live Re-test Status
Vorige live hertest vóór deployment `110cbfd7-08ef-4d6a-9851-9b22939b38ba`:
- `get-themes`: pass, live Impact theme `187324891450` bevestigd.
- `plan-theme-edit` voor portable FAQ: pass voor planning, maar de oude live runtime bleef Impact wrapper reads voorstellen.
- `get-theme-files`: pass voor exacte planner reads.
- `create-theme-section` voor `sections/hazify-regression-faq.liquid`: blocked, geen write uitgevoerd (`liveFileUnchanged=true`, readback `NOT_FOUND`). De oude live runtime blokkeerde nog met `inspection_failed_impact_wrapper`.
- `verify-theme-files`: execute pass met expliciete args op `sections/hazify-test-slider.liquid`, maar oude MCP metadata toonde deze tool nog als no-args.
- `patch-theme-file` non-mutating repair-test: pass voor exclusieve target-normalisatie; `nextArgsTemplate` bevatte alleen `themeId`, geen dubbele `themeRole`.
- `plan-theme-edit` negatie-test met "No images, no slider": fail in oude live runtime; `sectionContract.requiredFeatures` bevatte nog `slides` en `images`.

Na deployment `110cbfd7-08ef-4d6a-9851-9b22939b38ba`:
- Railway deployment: `SUCCESS`.
- MCP HTTP anonymous smoke: pass via `npm run release:postdeploy`; `/mcp` zonder token geeft correct `401`.
- Railway deploy logs filter `error OR warn`: leeg.
- Store-gekoppelde authenticated Hazify MCP tooltest: niet uitgevoerd in deze shell, omdat er geen `HAZIFY_MCP_SMOKE_TOKEN`/`MCP_SMOKE_TOKEN` is geconfigureerd en de Codex-toolnamespace voor `hazify_mcp` hier niet beschikbaar is. Eerdere appconnector-hertest gaf `token_invalidated`. Er zijn daardoor na deze deployment geen extra live theme files geschreven.

Nog opnieuw te bewijzen zodra de store-gekoppelde MCP-auth beschikbaar is:
- portable FAQ create zonder Impact wrappers;
- `feature-54` replica create met grote media + icon rows;
- `Slider 7` replica create met counter, peek cards, active contrast en echte controls;
- `plan-theme-edit` compact response met bruikbare `plannerHandoff`;
- `visualBrief`/`referenceAnalysis` doorvoer van plan naar create/draft;
- MCP metadata voor `verify-theme-files` met zichtbaar `expected[]` input schema.

## Release Validatie
- `npm run release:preflight`: pass.
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs apps/hazify-mcp-remote/tests/themeCodegenContract.test.mjs apps/hazify-mcp-remote/tests/themePlanning.test.mjs`: pass, `168` tests groen.
- `npm --prefix apps/hazify-mcp-remote test`: pass, `All hazify tests passed`.
- `npm run check:docs`: pass.
- `npm run build`: pass.
- `npm run check:repo`: pass.
- `npm run test:e2e`: pass.
- `npm audit --omit=dev`: pass na lock-update `fast-uri` `3.1.0` -> `3.1.2`.
- Shopify Dev MCP `learn_shopify_api(api="liquid")`: pass; officiële Liquid/theme-context geladen.
- Shopify Dev MCP `validate_theme`: pass op representatieve `feature-54`-achtige feature/media section. Artifact: `artifact-c0bb86f8-041d-48cf-8b57-d589f4fb3bcd`, revision 1.
- Shopify Dev MCP `validate_theme`: pass op representatieve `Slider 7`-achtige carousel section. Artifact: `artifact-6b7d541f-a7ff-416f-ab3b-1dfa96e65e75`, revision 1.
- Railway MCP status: pass; Railway CLI is geïnstalleerd en geauthenticeerd. Gekoppelde service: `Hazify-MCP-Remote`.

## Doelstatus
Lokaal en in de gedeployde code is het hoofddoel technisch dichterbij en technisch haalbaar voor de geteste regressies: de MCP-server kan portable Online Store 2.0 sections valideren zonder theme-specifieke Impact hardcoding, prompt-negaties correct interpreteren, image-renderpaden via Liquid variables herkennen, compacte responses geven, theme targets veiliger doorgeven, stateless planner-context bewaren en exacte feature/slider-replica anchors afdwingen.

Belangrijk: production smoke en Railway deploy zijn groen, maar de store-gekoppelde authenticated Hazify MCP-hertest is nog niet volledig bewezen na deze deployment zolang de connector/token ontbreekt. De code- en Shopify Dev-validatie bewijzen de lokale en generieke theme-compatibiliteit; echte store-data hertest moet alsnog worden uitgevoerd zodra authenticated MCP-tooling beschikbaar is.

## Deploy Status
- Commit: `6e57481 fix: preserve section replica context`.
- Push: `origin/main` bijgewerkt.
- Railway service: `Hazify-MCP-Remote`.
- Deployment: `110cbfd7-08ef-4d6a-9851-9b22939b38ba`.
- Deployment status: `SUCCESS`.
- Post-deploy smoke: pass via `npm run release:postdeploy`.
- Railway deploy logs filter `error OR warn`: leeg.
- Live MCP authenticated hertest na deploy: blocked door ontbrekende smoke token/toolnamespace; er zijn daardoor geen extra live theme files geschreven na de redeploy.
