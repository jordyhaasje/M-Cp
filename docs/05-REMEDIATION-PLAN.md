# Remediation Plan
Doelgroep: maintainers, developers en coding agents.

Versie: 2026-04-26.
Status: actieve tracker voor Shopify theme-toolchain remediation, sessie-handoff en releasevolgorde.

## Doel
`docs/04-MCP-REMOTE-AUDIT.md` blijft de canonieke auditbron. Dit document is het actieve werkbord voor:

- concrete patchbatches per file/tool
- sessie-handoff wanneer context schaars is of een nieuwe sessie start
- validator-, test- en docs-impact per wijziging
- expliciete beslissingen over welke docs actief blijven, gewijzigd moeten worden of later kunnen verdwijnen

## Tracker Discipline
Gebruik dit document als verplichte tracker zodra werk:

- meer dan 1 tool/file raakt
- meerdere sessies kan beslaan
- nieuwe validators of tests vereist
- bestaand gedrag, docs of toolflows verandert

Werk dit document dan in dezelfde wijziging bij met:

- huidige status per patchbatch
- doel-files/tools
- vereiste validators/tests
- docs die mee moeten wijzigen
- openstaande risico’s of vervolgstap

Bij een nieuwe of bijna volle sessie is de aanbevolen herstartvolgorde:

1. `docs/04-MCP-REMOTE-AUDIT.md`
2. dit document
3. de files uit de eerstvolgende actieve patchbatch

## Fase-overzicht
| Fase | Doel | Status | Canonieke bron |
| --- | --- | --- | --- |
| Fase 1 | Audit verankeren in repo | Afgerond | `docs/03`, `docs/04` |
| Fase 2 | Edit-flow, patch-locality en token-efficiency audit | Afgerond | dit document + `docs/04` |
| Fase 3 | Concrete implementatieplanning per file/tool | Actief | dit document |

## Huidige stand
### Vastgelegd
- Fase-1 auditregels zijn verankerd in `docs/03` en `docs/04`.
- Shopify-bronwaarheid is gecontroleerd voor `image_url`, `image_tag`, `block.shopify_attributes`, `content_for 'blocks'` en Liquid-gedrag in `{% stylesheet %}` / `{% javascript %}`.
- Context7 is gebruikt om MCP-toolfoutgedrag en toolgrenzen te valideren.
- Railway-logs bevestigen echte productiefouten rond schema labels, range-step limieten en image/media issues.

### Nog open
- bredere archetype-aware wrapperregels buiten de nu geharde media-first/full-bleed hero-familie
- hardere validators voor wrapper-correctheid en Theme Editor-contracten buiten de hero fix
- bredere native-block/theme-wrapper regressietests buiten de huidige schema/snippet/block-wrapper checks
- live authenticated production MCP read-smoke met expliciet productie-token is groen; alleen de read-only write-scope gate blijft credential-afhankelijk

## Concrete Patchbatches
Deze batches zijn bewust klein genoeg gehouden om gericht te patchen zonder opnieuw brede context op te halen.

### Batch A — Archetypes en Blueprint Contract
Status: `completed`
Prioriteit: `P1`

Doel:
- vervang de huidige hero-collapsing naar `hero_banner` door first-class archetypes
- scheid section-archetype expliciet van theme-convention mirroring
- maak de planner-output structureler voor create- en editflows

Files/tools:
- `apps/hazify-mcp-remote/src/lib/themeSectionContext.js`
- `apps/hazify-mcp-remote/src/lib/themePlanning.js`
- `apps/hazify-mcp-remote/src/tools/planThemeEdit.js`
- `apps/hazify-mcp-remote/src/tools/createThemeSection.js`

Concrete wijzigingen:
- voeg minstens toe:
  - `hero_media_first_overlay`
  - `hero_split_layout`
  - `hero_boxed_shell`
  - `hero_full_bleed_media`
- laat `sectionBlueprint` naast `archetype` ook structurele velden dragen zoals:
  - `outerShell`
  - `contentWidthStrategy`
  - `mediaPlacement`
  - `overlayRequired`
  - `fallbackMediaStrategy`
- maak duidelijk onderscheid tussen:
  - outer shell
  - inner content width
  - theme helper/wrapper hints

Vereiste tests:
- `apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`

Docs die mee moeten wijzigen:
- `docs/03-THEME-SECTION-GENERATION.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document

Lokaal geverifieerd:
- `node --test apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/toolHardening.test.mjs`

Afgeronde uitkomst:
- planner-classificatie onderscheidt nu `hero_media_first_overlay`, `hero_split_layout`, `hero_boxed_shell` en `hero_full_bleed_media`
- `sectionBlueprint` en `plannerHandoff` dragen nu ook `layoutContract` en `themeWrapperStrategy`
- full-bleed/media-first hero-plans geven nu expliciete warnings terug tegen split-layout degradatie en blinde outer containerization

### Batch B — Validator Hardening Voor Shopify Correctheid
Status: `completed`
Prioriteit: `P1`

Doel:
- maak bewezen Shopify-/theme-editor-/mediafouten hard afdwingbaar
- laat archetype-regels niet alleen adviserend, maar ook inspecteerbaar zijn

Files/tools:
- `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`

Concrete wijzigingen:
- hard fail voor ontbrekend gedeeld media-slot tussen fallback en uploaded media
- hard fail voor media-first versus split-layout DOM-mismatch in exacte media-driven replica’s
- hard fail voor full-bleed hero met onterechte outer `.container` of `page-width`
- hard fail voor raw Shopify-media via `<img>`, ook als width/height al aanwezig zijn
- maak `block.shopify_attributes` blocker in relevante section/snippet/block-render contexts
- maak `video_url` versus `video` strenger voor merchant-uploaded media-archetypes

Vereiste tests:
- `apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`

Docs die mee moeten wijzigen:
- `docs/03-THEME-SECTION-GENERATION.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document

Lokaal geverifieerd:
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`

Afgeronde uitkomst:
- `draft-theme-artifact` faalt nu hard op:
  - raw Shopify-media `<img>` met `image_url` / `img_url`, ook wanneer width/height al aanwezig zijn
  - ontbrekende `block.shopify_attributes` in relevante section-loops en native block-render snippets
  - hosted `<video>` / `video_tag` markup wanneer schema alleen `video_url` aanbiedt
  - exacte media-first heroes die onterecht split-layout worden
  - exacte media-first heroes die de outer shell boxen met `page-width` / `.container`
  - exacte media-first heroes waarvan fallback-media en uploaded media niet hetzelfde primaire media-slot delen
- hardcoded demo-media met expliciete dimensies blijft toegestaan als fallbackpad, zodat screenshot-only/exact-replica previewflows niet onnodig regressie krijgen
- de cross-theme acceptance matrix blijft groen na deze hardening, dus bestaande create/edit/native-block/template-placement flows houden hun preview-ready pad

### Batch C — Change-Scope Classifier en Patchbare Diagnostics
Status: `completed`
Prioriteit: `P1`

Doel:
- verminder heuristische toolkeuze
- vertaal validatoruitvoer directer naar patchtargets

Files/tools:
- `apps/hazify-mcp-remote/src/lib/themePlanning.js`
- `apps/hazify-mcp-remote/src/tools/patchThemeFile.js`
- `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
- `apps/hazify-mcp-remote/src/tools/planThemeEdit.js`

Concrete wijzigingen:
- introduceer expliciete classifierwaarden:
  - `micro_patch`
  - `bounded_rewrite`
  - `multi_file_structural_edit`
  - `net_new_generation`
- geef in diagnostics bij voorkeur terug:
  - `fileKey`
  - `path`
  - `preferredWriteMode`
  - `searchString`
  - `replaceString`
  - `anchorCandidates`
- laat `patch-theme-file` en repair-responses concretere `nextArgsTemplate`-anchors genereren

Vereiste tests:
- `apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `apps/hazify-mcp-remote/tests/toolHardening.test.mjs`
- `apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`

Docs die mee moeten wijzigen:
- `docs/03-THEME-SECTION-GENERATION.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document

Lokaal geverifieerd:
- `node --test apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/toolHardening.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`

Afgeronde uitkomst:
- `themePlanning` en `plan-theme-edit` geven nu expliciet `changeScope`, `preferredWriteMode` en `diagnosticTargets` terug, en dragen die ook mee in `plannerHandoff`
- plannerflows classificeren nu voorspelbaar als:
  - `micro_patch`
  - `bounded_rewrite`
  - `multi_file_structural_edit`
  - `net_new_generation`
- `patch-theme-file` repair-responses geven nu ook machine-leesbare targets terug voor broad-scope en anchor-failures, inclusief `diagnosticTargets` en `alternativeNextArgsTemplates.patchRetry`
- `draft-theme-artifact` leidt nu ook voor patch- en rewrite-failures expliciet `changeScope`, `preferredWriteMode` en `diagnosticTargets` af, zodat vervolgpatches minder heuristisch worden
- ambigue patch-anchors geven nu concrete `anchorCandidates` terug uit de laatst bekende exacte file-read in plaats van alleen tekstuele foutuitleg

### Batch D — Token-Efficiënte Reads en Memory Discipline
Status: `completed`
Prioriteit: `P2`

Doel:
- haal minder volledige filecontent op wanneer een compacte zoek- of patchroute volstaat
- beperk contextverlies zonder steeds alles opnieuw te lezen

Files/tools:
- `apps/hazify-mcp-remote/src/tools/getThemeFile.js`
- `apps/hazify-mcp-remote/src/tools/getThemeFiles.js`
- `apps/hazify-mcp-remote/src/tools/searchThemeFiles.js`
- `apps/hazify-mcp-remote/src/lib/themePlanning.js`
- `apps/hazify-mcp-remote/src/lib/themeReadHydration.js`
- `apps/hazify-mcp-remote/src/lib/themeEditMemory.js`

Concrete wijzigingen:
- `get-theme-file` is nu metadata-first wanneer `includeContent` ontbreekt; alleen exacte planner-required single-file reads hydrateren automatisch content
- `get-theme-files` hydrateert alleen nog automatisch content wanneer de gevraagde keyset exact overeenkomt met de planner `nextReadKeys`
- metadata-only batch-reads strippen defensief `value`, `attachment` en `url`, zodat tooloutput niet per ongeluk full-content lekt
- `themePlanning` leest surgical existing-edits minder eager:
  - renderer-snippets worden niet meer standaard volledig ingelezen
  - templatekeuze gebeurt eerst metadata-first; alleen het gekozen template wordt daarna met content gehydrateerd
  - compacte snippet-search overfetcht minder agressief
- `themeEditMemory` ruimt verlopen full-content reads actief op en geeft volledige filecontent een kortere TTL dan algemene flow-memory via `HAZIFY_MCP_THEME_EDIT_MEMORY_CONTENT_TTL_MS`
- `themeReadHydration` bleef inhoudelijk al exact genoeg voor write-kritieke reads; de winst in Batch D zit daarom vooral in minder onnodige full reads vóór die hydratiestap

Vereiste tests:
- `apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `apps/hazify-mcp-remote/tests/toolHardening.test.mjs`
- `apps/hazify-mcp-remote/tests/remediation.test.mjs`
- `apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`

Docs die mee moeten wijzigen:
- `docs/03-THEME-SECTION-GENERATION.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document

Lokaal geverifieerd:
- `npm run release:preflight`
- `node --test apps/hazify-mcp-remote/tests/toolHardening.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/remediation.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`

Afgeronde uitkomst:
- kleine bestaande single-file editflows trekken nu minder snel volledige filebodies mee
- planner-reads voor writes blijven nog steeds exact genoeg voor `patch-theme-file`, `create-theme-section` en `draft-theme-artifact`
- partial-overlap batch-reads blijven metadata-first, waardoor tokengebruik voorspelbaarder wordt in stateless en bijna-volle sessies
- sessiememory bewaart niet langer automatisch urenlang volledige theme-filecontent als die niet meer write-kritiek is
- live parity voor deze tranche is bevestigd op `Hazify-MCP-Remote` via Railway deployment `b592ad92-07a4-4f7d-9ecf-6d3259cd48b4` en `npm run release:postdeploy`

### Pre-Batch-E Hardening — Hero Wrapper Contract
Status: `completed`
Prioriteit: `P1`

Doel:
- voorkom dat media-first/full-bleed heroes nog outer wrapper-mirroring erven vanuit representatieve theme-context
- maak de wrapperbeslissing contract-aware per hero-shell-familie in plaats van screenshot-only of representatieve `heroLike` heuristiek
- blokkeer ook subtiel boxed gedrag waarbij niet de root, maar wel de media-shell in `page-width`, `container` of `section-properties` vastloopt

Files/tools:
- `apps/hazify-mcp-remote/src/lib/themeSectionContext.js`
- `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
- `apps/hazify-mcp-remote/src/lib/themePlanning.js`

Concrete wijzigingen:
- `requiresThemeWrapperMirror` volgt nu de afgeleide `heroShellFamily` in plaats van representatieve `heroLike`-context voor media-first/full-bleed hero-shells
- `hero_media_first_overlay` en `hero_full_bleed_media` behandelen de media-shell nu expliciet als outer bounds; `hero_banner` kan alleen nog naar die familie doorvallen wanneer de prompt/query echt op edge-to-edge/background-media/text-over-image wijst zonder boxed/split signalen
- `layoutContract` en `themeWrapperStrategy` dragen nu explicieter dat de outer media-shell de bounds bezit en dat theme wrappers alleen op inner content/spacer-lagen thuishoren
- `draft-theme-artifact` blokkeert nu ook `exact_match_media_shell_boxed_by_wrapper` wanneer een theme wrapper de media-shell effectief boxet zonder dat de root zelf boxed lijkt
- plannerwarnings benoemen nu expliciet dat helpers zoals `page-width`, `container` en `section-properties` op een inner content- of spacer-laag thuishoren, niet op de outer media-shell
- de fix voegt geen extra theme reads toe: hero-shell-familie gebruikt bestaande plannerinput en de nieuwe validatorcheck werkt volledig op lokaal gegenereerde Liquid/CSS-markup

Vereiste tests:
- `apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`

Docs die mee moeten wijzigen:
- `docs/03-THEME-SECTION-GENERATION.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document

Lokaal geverifieerd:
- `node --test apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`

Afgeronde uitkomst:
- media-first/full-bleed hero-shells houden nu hun outer full-bleed bounds ook wanneer het doeltheme `page-width` of `section-properties` gebruikt
- prompt-only en screenshot-driven unboxed hero-prompts delen nu hetzelfde wrappercontract zonder screenshot-only uitzonderingsregel
- validators keuren nu zowel een boxed outer root als een boxed media-shell af
- Batch E kan hierdoor verder op review/video/PDP/blocks zonder de foutieve hero-wrapperdefault mee te nemen
- live parity voor deze hardening is bevestigd op `Hazify-MCP-Remote` via Railway deployment `79119e1a-464c-49e2-8569-26b5bb7fdb7f`, Railway logreview en een groene `npm run release:postdeploy` na een directe retry op een transient bootstrap-502

### Batch E — Brede Coverage Buiten Hero’s
Status: `active`
Prioriteit: `P2`

Doel:
- pas dezelfde archetype-, validator- en editflow-principes toe op review/video/blocks/PDP/prompt-only generation

Files/tools:
- `apps/hazify-mcp-remote/src/lib/themeSectionContext.js`
- `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
- `apps/hazify-mcp-remote/src/tools/createThemeSection.js`
- `apps/hazify-mcp-remote/src/lib/themePlanning.js`

Concrete wijzigingen:
- review/video sections niet langer alleen via hero-achtige guardrails benaderen
- native blocks en `blocks/*.liquid` routes dezelfde Theme Editor- en media-correctheid geven
- bestaande edits op review/video/PDP explicieter naar patch of bounded rewrite sturen

Tranche 1 afgerond:
- `themeSectionContext` kent nu ook non-hero shell-families:
  - `bounded_card_shell` voor exacte review/comparison card-surfaces
  - `media_surface` voor video/social/media sliders en galleries
  - `commerce_scaffold` voor `native_block` en commerce-sections
- `themePlanning` geeft nu expliciet warnings voor:
  - bounded shell + inner card requirements bij review/comparison replica’s
  - strikt `video` versus `video_url` gebruik voor `video_section` / `video_slider`
  - behoud van bestaande product/PDP scaffold in commerce/native-block flows
- `draft-theme-artifact` faalt nu hard op:
  - `video_section` / `video_slider` met externe embeds zonder `video_url`
  - `blocks/*.liquid` zonder `block.shopify_attributes`
  - `blocks/*.liquid` zonder renderbare block-markup
  - exacte review/comparison replicas zonder bounded shell of zonder inner card/panel surface

Tranche 2 afgerond:
- `themeSectionContext` bouwt nu `promptContract` metadata voor prompt-only review/video/PDP flows:
  - review/testimonial prompts vereisen review-signalen, review-card/panel surface, rating/quote-signalen en herhaalbare blocks wanneer meerdere reviews gevraagd worden
  - video prompts vereisen een merchant-editable `video` of `video_url` setting plus renderbaar blank-safe video-pad
  - PDP/product prompts vereisen productcontext of een `product` setting plus echte commerce action/helper signalen
- `review_section` en `pdp_section` zijn nu expliciete archetypen naast de bestaande slider/video/commerce families.
- `themePlanning` waarschuwt in `plan-theme-edit` direct wanneer een prompt-only review/video/PDP write geen generieke baseline mag worden.
- `create-theme-section` draagt de prompt-only contracten via `plannerHandoff.sectionBlueprint.promptContract` door naar de write-pipeline.
- `draft-theme-artifact` faalt vóór preview-write op:
  - `prompt_review_missing_content_signals`
  - `prompt_review_missing_block_cards`
  - `prompt_review_missing_card_surface`
  - `prompt_review_missing_rating_or_quote`
  - `prompt_slider_missing_controls`
  - `prompt_video_missing_source_setting`
  - `prompt_video_missing_render_path`
  - `prompt_pdp_missing_product_source`
  - `prompt_pdp_missing_commerce_action`
- De cross-theme acceptance matrix gebruikt voor review-archetypen nu een echte review-card fixture met blocks, `block.shopify_attributes`, rating/sterren, quote/author en blank-safe `image_picker`.
- Bestaande review/video/PDP edits hebben planner-regressies die surgical mobile/single-file prompts in `patch-existing` houden.

Nog open binnen Batch E:
- bredere native product-block renderer-contracten toevoegen voor theme-architecturen buiten de huidige schema/snippet/block-wrapper checks
- wrapper-correctheid buiten media-first/full-bleed heroes en exacte bounded card-surfaces verder universeler maken zonder theme-conventies te breken

Vereiste tests voor tranche 2:
- prompt-only review/video generatie: afgerond
- non-hero `video_section` / `video_slider`: afgerond
- review sections met wrapper/rating/badge anchors: afgerond voor review-card/rating en merchant-media anchors
- native `blocks/*.liquid` positive path: al gedekt in tranche 1
- bestaande edit regressies voor review/video/PDP: afgerond voor surgical plannerflows

Lokaal geverifieerd voor tranche 1:
- `node --test apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`

Lokaal geverifieerd voor tranche 2:
- `node --test apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`
- Shopify Dev MCP `liquid` documentatiecheck voor sections/blocks, `block.shopify_attributes`, image filters, video-rendering conventies en product forms
- Context7 MCP SDK check voor herstelbare tool-level errors via `isError: true`, `structuredContent` en output schema gedrag

Afgeronde uitkomst van tranche 1:
- non-hero exact replicas krijgen nu niet meer alleen hero- of generieke content-contracten mee
- strikte video-archetypen blokkeren nu schema/render-mismatches harder
- theme blocks hebben nu ook een minimale render- en Theme Editor-contractlaag
- Batch E kan nu verder op prompt-only review/video/PDP coverage zonder deze basischecks opnieuw te ontwerpen
- codegedeelte van tranche 1 is live gedeployed op `Hazify-MCP-Remote` via Railway deployment `7b4b947c-7630-45cc-a1c9-de2078dbe460`
- publieke MCP endpoint-checks zijn daar groen:
  - `/.well-known/oauth-protected-resource` -> `200`
  - `/.well-known/oauth-authorization-server` -> `200`
  - anonieme `POST /mcp` -> `401`
- repo-brede `release:postdeploy` parity bleef na deze redeploy destijds rood door een terugkerende `502 Application failed to respond` op `Hazify-License-Service /health`; publieke smoke is op 2026-04-25 opnieuw groen, dus dit is geen actuele blocker meer

Afgeronde uitkomst van tranche 2:
- prompt-only review/video/PDP generation heeft nu dezelfde eerste-write discipline als exacte flows: onvolledige of generieke output wordt lokaal geblokkeerd voordat naar het theme geschreven wordt
- de nieuwe checks voegen geen extra Shopify reads toe en blijven tokenzuinig doordat ze alleen het plannercontract en het pre-write artifact inspecteren
- live parity voor tranche 2 is bevestigd op `Hazify-MCP-Remote` via Railway deployment `06a69e4e-5505-47fc-95a4-931122a926a7`, runtime-logreview en groene `npm run smoke:prod`

Docs die mee moeten wijzigen:
- `docs/03-THEME-SECTION-GENERATION.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document

### Batch G — MCP/Shopify Contract Cleanup
Status: `completed`
Prioriteit: `P1/P2`

Doel:
- los de niet-Batch-E open punten uit de audit op voordat de bredere theme-fidelity tranche verdergaat
- voorkom voorspelbare Shopify GraphQL errors vóór reads/writes
- maak non-theme toolfouten herstelbaar voor MCP-clients
- trek het laatste ontbrekende kritieke outputcontract gelijk

Files/tools:
- `apps/hazify-mcp-remote/src/tools/getOrderById.js`
- `apps/hazify-mcp-remote/src/tools/updateFulfillmentTracking.js`
- `apps/hazify-mcp-remote/src/lib/shopifyToolErrors.js`
- `apps/hazify-mcp-remote/src/tools/createProduct.js`
- `apps/hazify-mcp-remote/src/tools/updateProduct.js`
- `apps/hazify-mcp-remote/src/tools/manageProductVariants.js`
- `apps/hazify-mcp-remote/src/tools/manageProductOptions.js`
- `apps/hazify-mcp-remote/src/tools/deleteProduct.js`
- `apps/hazify-mcp-remote/src/tools/deleteProductVariants.js`
- `apps/hazify-mcp-remote/src/tools/refundOrder.js`
- `apps/hazify-mcp-remote/src/tools/updateCustomer.js`
- `apps/hazify-mcp-remote/src/tools/updateOrder.js`
- `apps/hazify-mcp-remote/src/tools/registry.js`
- `apps/hazify-mcp-remote/tests/toolHardening.test.mjs`
- `apps/hazify-mcp-remote/tests/toolRegistry.test.mjs`
- `apps/hazify-mcp-remote/tests/runtimeExecutionBehavior.test.mjs`

Concrete wijzigingen:
- `get-order-by-id` gebruikt niet meer de verouderde eerste queryvorm `fulfillments(first: ...){ nodes }`; de primaire query gebruikt nu `fulfillments { ... }`.
- `get-order-by-id` leest customer email/phone nu via `defaultEmailAddress.emailAddress` en `defaultPhoneNumber.phoneNumber` in plaats van de gedepricieerde `Customer.email` en `Customer.phone`.
- `update-fulfillment-tracking` gebruikt voor order tracking context direct de actuele `Order.fulfillments` lijstvorm en triggert niet langer eerst een voorspelbare GraphQL schemafout.
- Shopify `userErrors` uit product-, order-, customer-, refund- en fulfillment-mutaties worden genormaliseerd naar `success=false`, `status="shopify_user_error"`, `operation`, `errors[]` en `suggestedFixes[]`.
- `get-supported-tracking-companies` heeft nu een expliciet `outputSchema`.

Bronvalidatie:
- Shopify Dev MCP valideerde de aangepaste `GetOrderById`, `getOrderTrackingContext`, `fulfillmentTrackingInfoUpdate` en `fulfillmentCreate` GraphQL operations als geldig tegen de actuele Admin GraphQL schema.
- Context7 voor de MCP TypeScript SDK bevestigt dat tool-level failures via `isError: true` zichtbaar en herstelbaar zijn voor LLM-clients en dat output schema-validatie bij `isError` wordt overgeslagen.
- De code is leidend boven eerdere documentatiestatus: de oude 502- en query-shape-notities zijn bijgewerkt nadat ze tegen code, tests en productie-smoke zijn getoetst.

Vereiste tests:
- `node --test apps/hazify-mcp-remote/tests/toolHardening.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/toolRegistry.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/runtimeExecutionBehavior.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/remediation.test.mjs`
- `npm run release:preflight`

Docs die mee moeten wijzigen:
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document

Afgeronde uitkomst:
- non-Batch-E P1/P2 contractpunten zijn lokaal gerepareerd
- voorspelbare Shopify schema-errors rond fulfillment reads zijn vóór uitvoering weggehaald
- LLM-clients krijgen meer herstelbare, machine-leesbare toolresultaten bij Shopify validatiefouten
- lokale verificatie is groen via de gerichte regressietests en de volledige `npm run release:preflight`
- publieke productie-smoke op 2026-04-25 is groen voor License Service health/bootstrap en MCP metadata/anonieme auth-check; authenticated MCP tool-smoke blijft apart open

### Batch H — Auth, Tenant Isolation en Repo Truth
Status: `completed lokaal`
Prioriteit: `P1/P2`

Doel:
- sluit de acht review findings van 2026-04-25 zonder docs/code-drift
- maak auth-, entitlement-, draft- en verify-contracten fail-closed voor multi-tenant gebruik
- zet Shopify- en MCP-bronwaarheid direct in docs en tests

Files/tools:
- `packages/mcp-common/src/index.js` plus Railway mirrors
- `packages/shopify-core/src/index.js` plus Railway mirrors
- `apps/hazify-license-service/src/routes/oauth.js`
- `apps/hazify-license-service/src/views/pages.js`
- `apps/hazify-mcp-remote/src/index.js`
- `apps/hazify-mcp-remote/src/lib/themeFiles.js`
- `apps/hazify-mcp-remote/src/tools/*Theme*.js`
- `apps/hazify-mcp-remote/src/tools/_themeToolCompatibility.js`
- regressies in `apps/hazify-license-service/tests/*`, `apps/hazify-mcp-remote/tests/mcpHttpAuth.test.mjs`, `mcpScopeEnforcement.test.mjs`, `draftThemeArtifact.test.mjs` en `toolHardening.test.mjs`

Concrete wijzigingen:
- onbekende `mcp:*` scopes normaliseren niet meer naar `mcp:tools`; OAuth en remote introspection falen dicht
- OAuth/introspection resource-binding vergelijkt token `resource` / `targetResource` / `aud` met de publieke MCP `/mcp` resource
- tool-entitlements checken aliasnaam én canonieke toolnaam
- `apply-theme-draft` weigert drafts waarvan `shop_domain` niet overeenkomt met de request-shop
- verify-after-write `mismatch`, `missing` of verify-error maakt preview/apply failure
- role-only theme targeting is beperkt tot `themeRole='main'`; non-main roles vereisen `themeId`
- required Shopify scopes bevatten nu `read_merchant_managed_fulfillment_orders`
- custom-app onboarding zet Admin API access token als primaire route en verwijdert de niet-bestaande `/oauth/shopify/callback` redirect-instructie

Bronvalidatie:
- Shopify Dev MCP bevestigde `ThemeRole.MAIN` als enige unieke role, fulfillment-order read scopes, en Admin API access-token authenticatie via `X-Shopify-Access-Token`.
- Context7 MCP SDK docs bevestigden tool-level errors via `isError: true` en Host-header validatie voor HTTP MCP servers.

Lokaal geverifieerd:
- `node --test apps/hazify-license-service/tests/oauth-helpers.test.mjs apps/hazify-license-service/tests/oauth-security.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/mcpScopeEnforcement.test.mjs apps/hazify-mcp-remote/tests/mcpHttpAuth.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs apps/hazify-mcp-remote/tests/toolHardening.test.mjs`

Docs die mee gewijzigd zijn:
- `docs/01-TECH-STACK.md`
- `docs/02-SYSTEM-FLOW.md`
- `docs/03-THEME-SECTION-GENERATION.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document
- app READMEs en gegenereerde tooldocs via `npm run generate:docs`

Open na Batch H:
- geen bekende P1/P2 codeblocker
- live authenticated production MCP read-smoke met expliciet productie-token is groen
- read-only write-scope gate blijft credential-afhankelijk tot er een read-only smoke-token beschikbaar is

Release/live bewijs:
- volledige `npm run release:preflight` is groen op 2026-04-26
- commit `8e3c114` is gepusht naar `origin/codex/harden-mcp-truth`
- `Hazify-MCP-Remote` is live gedeployed via Railway deployment `05a12c2a-203f-4191-b350-99284dd79e62`
- `Hazify-License-Service` is live gedeployed via Railway deployment `9977e9d5-390b-485f-a743-701e723a27c2`
- `npm run release:postdeploy` is groen: License `/health -> 200`, License `/v1/session/bootstrap -> 200`, MCP metadata endpoints -> `200`, anonieme `POST /mcp -> 401`
- Railway runtime-logreview toont geen nieuw foutpatroon; alleen bestaande `npm warn config production`, eerdere MCP `punycode` warning en verwachte anonieme `/mcp` unauthorized log. De lokale runtime gebruikt nu native `fetch` voor Shopify GraphQL en laadt `@shopify/theme-check-node` lazy zodat docs/build/startup de oude `graphql-request`/`cross-fetch` en theme-check dependency routes niet meer onnodig activeren.
- Wanneer theme-check linting echt draait kan de upstream Shopify dependency nog wel een `punycode` deprecation tonen; dat is nu lint-route hygiene en geen docs/startup warning meer.
- `npm audit --omit=dev` is groen met 0 kwetsbaarheden na lockfile-updates voor Hono, `@hono/node-server`, `path-to-regexp` en `lodash`.

### Batch F — Docs Waarheid en Opschoning
Status: `active`
Prioriteit: `doorlopend`

Doel:
- docs synchroon houden met code en auditstatus
- alleen verwijderen wanneer een document echt overbodig is geworden

Actieve regels:
- wijzig codegedrag -> update docs in dezelfde wijziging
- wijzig generation-routes/validators -> update `docs/03`
- wijzig auditwaarheid, blockers of confirmed issues -> update `docs/04`
- wijzig tranche-status, patchvolgorde of handoff -> update dit document
- wijzig documentrollen of leesvolgorde -> update `docs/00-START-HERE.md` en `docs/README.md`
- verwijder nu geen genummerde docs; `docs/04` en `docs/05` mogen later wel compacter door historische completed batches naar tabellen samen te vatten

## Sessie-Handoff Snapshot
Gebruik dit blok als snelle hervatting in een nieuwe sessie.

### Volgende aanbevolen patchbatch
`Release/Ops — read-only write-scope smoke-token en niet-blokkerende warning monitoring`

### Open release- en ops-signalen
- `Hazify-MCP-Remote` redeploy `06a69e4e-5505-47fc-95a4-931122a926a7` is gezond en live
- codewijzigingen uit Batch G, Batch E tranche 2 en Host-header hardening zijn gepusht en live gedeployed op `Hazify-MCP-Remote`
- buildlog toont alleen bekende niet-blokkerende waarschuwingen:
  - `npm warn config production`
  - `inflight` / `glob` deprecations tijdens `npm ci`
  - eerdere `punycode` deprecation tijdens docs/build; de code gebruikt nu native `fetch` voor Shopify GraphQL en laadt theme-check lazy zodat docs/build/startup die dependencyroutes niet meer direct hoeven te raken
- de eerdere MCP SDK `0.0.0.0` / DNS-rebinding warning is opgelost via `allowedHosts` Host-header validatie
- publieke productie-smoke is op 2026-04-25 groen:
  - `Hazify-License-Service /health` -> `200`
  - `Hazify-License-Service /v1/session/bootstrap` -> `200`
  - MCP protected-resource metadata -> `200`
  - MCP authorization-server metadata -> `200`
  - anonieme `POST /mcp` -> `401`
- admin- en billing-readiness zijn in de lokale smoke overgeslagen omdat de vereiste secrets niet aanwezig waren
- authenticated production MCP read-smoke met expliciet productie-token is live groen: `initialize`, `tools/list` en `get-license-status`
- read-only write-scope gate blijft open tot er lokaal een geldige read-only smoke-token is

### Waarom deze eerst
- de belangrijkste lokale open punten voor Batch G en Batch E tranche 2 zijn nu gerepareerd
- de grootste resterende onzekerheid zit niet in lokale code of publieke/authenticated productiepariteit, maar alleen nog in een read-only write-scope gate met expliciete read-only token

### Minimale files voor de volgende sessie
- `docs/04-MCP-REMOTE-AUDIT.md`
- `docs/05-REMEDIATION-PLAN.md`
- `scripts/release-status.mjs`
- read-only productie-token/tenantconfig voor write-scope gate smoke

### Bekende harde waarheden
- een hero met content links en media rechts is niet automatisch een split-layout
- media-first hero-architectuur hoort `media -> overlay -> content` te blijven
- fallback en uploaded image moeten hetzelfde media-slot delen
- full-bleed sections mogen niet blind door theme wrappers boxed worden
- page-width, container en section-properties mogen bij media-first/full-bleed heroes alleen op inner content/spacer-lagen landen
- `block.shopify_attributes` is functioneel belangrijk, niet alleen cosmetisch

## Documentatiebeheer
### Actieve documenten en huidige beslissing
| Document | Rol | Beslissing |
| --- | --- | --- |
| `docs/00-START-HERE.md` | leesvolgorde en repo-intake | behouden |
| `docs/01-TECH-STACK.md` | infra- en stackwaarheid | behouden |
| `docs/02-SYSTEM-FLOW.md` | runtime- en toolflow-overzicht | behouden |
| `docs/03-THEME-SECTION-GENERATION.md` | generation-regels en canonical flows | behouden |
| `docs/04-MCP-REMOTE-AUDIT.md` | auditbron en confirmed issues | behouden |
| `docs/05-REMEDIATION-PLAN.md` | actieve tracker, handoff en docs-governance | behouden |

### Verwijdercriteria
Verwijder een document pas als alle onderstaande voorwaarden waar zijn:

- het document niet meer canoniek is voor enige actieve workflow
- de inhoud volledig, expliciet en zonder verlies is opgenomen in een ander actief document
- `docs/README.md`, `docs/00-START-HERE.md` en andere verwijzingen zijn bijgewerkt
- de verwijdering maakt de repo duidelijker in plaats van ambiguër

### Huidige verwijderbeslissing
- Er wordt nu geen document verwijderd.
- De huidige set van `docs/00` t/m `docs/05` heeft nog steeds duidelijke, niet-overlappende rollen.

## Releasepolicy
- Gebruik eerst `npm run release:status` om te bepalen of commit, push of Railway redeploy nodig is.
- Gebruik `npm run release:preflight` zodra runtime-code, mirrored packages of meerdere workspaces geraakt zijn.
- `npm run smoke:prod` hoort pas ná een deploy en telt niet als pre-deploy bewijs.
- Docs-only en test-only wijzigingen vereisen geen code-based Railway redeploy.

## Redeploy-matrix
| Wijzigingsscope | Commit nodig | Push nodig | Railway redeploy |
| --- | --- | --- | --- |
| `apps/hazify-mcp-remote/src/**`, `apps/hazify-mcp-remote/packages/**`, `apps/hazify-mcp-remote/package.json` | Ja | Ja | `Hazify-MCP-Remote` |
| `apps/hazify-license-service/src/**`, `apps/hazify-license-service/packages/**`, `apps/hazify-license-service/package.json` | Ja | Ja | `Hazify-License-Service` |
| `packages/**`, root `package.json`, root `package-lock.json` | Ja | Ja | Meestal beide services |
| `docs/**`, `AGENTS.md`, test-only wijzigingen | Ja als je ze wilt bewaren | Alleen als commit ahead staat | Geen code-based redeploy |
| Railway env-only wijziging | Nee | Niet per se | Redeploy van de getroffen service, plus smoke/logreview |
