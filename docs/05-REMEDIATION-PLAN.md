# Remediation Plan
Doelgroep: maintainers, developers en coding agents.

Versie: 2026-04-22.
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
- bredere regressietests voor review/video/blocks/prompt-only flows

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

Nog open binnen Batch E:
- prompt-only review/video/PDP fidelity verder verharden buiten exact-reference flows
- `create-theme-section` prompt-only planning rijker maken voor non-hero archetypen
- bredere PDP/native-block renderer-contracten toevoegen buiten de huidige schema/block-wrapper checks
- acceptance- en create-suite uitbreiden voor review/video/PDP prompt-only regressies

Vereiste tests:
- prompt-only review/video generatie
- non-hero `video_section` / `video_slider`
- review sections met wrapper/rating/badge anchors
- native `blocks/*.liquid` positive path
- bestaande edit regressies voor review/video/PDP

Lokaal geverifieerd voor tranche 1:
- `node --test apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `node --test apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`

Afgeronde uitkomst van tranche 1:
- non-hero exact replicas krijgen nu niet meer alleen hero- of generieke content-contracten mee
- strikte video-archetypen blokkeren nu schema/render-mismatches harder
- theme blocks hebben nu ook een minimale render- en Theme Editor-contractlaag
- Batch E kan nu verder op prompt-only review/video/PDP coverage zonder deze basischecks opnieuw te ontwerpen

Docs die mee moeten wijzigen:
- `docs/03-THEME-SECTION-GENERATION.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document

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

## Sessie-Handoff Snapshot
Gebruik dit blok als snelle hervatting in een nieuwe sessie.

### Volgende aanbevolen patchbatch
`Batch E — tranche 2: prompt-only review/video/PDP coverage`

### Waarom deze eerst
- de hero/media-first fundering bevat nu ook de pre-Batch-E wrappercontract-fix, dus de grootste resterende kwaliteitswinst zit in review/video/PDP/blocks buiten de hero-cases
- Batch E maakt de archetype- en validatorlogica breder toepasbaar op prompt-only generation, bestaande edits en non-hero sections

### Minimale files voor de volgende sessie
- `apps/hazify-mcp-remote/src/lib/themeSectionContext.js`
- `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
- `apps/hazify-mcp-remote/src/tools/createThemeSection.js`
- `apps/hazify-mcp-remote/src/lib/themePlanning.js`
- `apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `apps/hazify-mcp-remote/tests/crossThemeAcceptanceMatrix.test.mjs`

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
