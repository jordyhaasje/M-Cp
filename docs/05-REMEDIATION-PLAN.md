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
- first-class archetypes voor media-first versus split-layout hero’s
- hardere validators voor media-slot-consistentie, wrapper-correctheid en Theme Editor-contracten
- expliciete change-scope classifier voor micro-patch versus rewrite
- small-patch en token-efficiency verbeteringen in read/search/memory
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
Status: `pending`
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
- heroverweeg `get-theme-file` default `includeContent=true`
- verminder planner-snippetreads die nu eerst full content ophalen
- bewaar in memory waar mogelijk samengevatte anchors/slices in plaats van altijd volledige content
- houd planner-required hydration exact en smal

Vereiste tests:
- `apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `apps/hazify-mcp-remote/tests/toolHardening.test.mjs`
- eventuele nieuwe tests voor memory/readback scope

Docs die mee moeten wijzigen:
- `docs/03-THEME-SECTION-GENERATION.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- dit document

### Batch E — Brede Coverage Buiten Hero’s
Status: `pending`
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

Vereiste tests:
- prompt-only review/video generatie
- non-hero `video_section` / `video_slider`
- review sections met wrapper/rating/badge anchors
- native `blocks/*.liquid` positive path
- bestaande edit regressies voor review/video/PDP

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
`Batch D — Token-Efficiënte Reads en Memory Discipline`

### Waarom deze eerst
- Batch C maakt write-scope en repair-targets nu expliciet, dus de grootste resterende winst zit in minder full-content reads en slankere memory/hydration
- dit is de logische vervolgstap voor lagere tokenlast, snellere iteratie en betere kleine patchflows buiten de hero-cases

### Minimale files voor de volgende sessie
- `apps/hazify-mcp-remote/src/tools/getThemeFile.js`
- `apps/hazify-mcp-remote/src/tools/getThemeFiles.js`
- `apps/hazify-mcp-remote/src/tools/searchThemeFiles.js`
- `apps/hazify-mcp-remote/src/lib/themePlanning.js`
- `apps/hazify-mcp-remote/src/lib/themeReadHydration.js`
- `apps/hazify-mcp-remote/src/lib/themeEditMemory.js`
- `apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `apps/hazify-mcp-remote/tests/toolHardening.test.mjs`

### Bekende harde waarheden
- een hero met content links en media rechts is niet automatisch een split-layout
- media-first hero-architectuur hoort `media -> overlay -> content` te blijven
- fallback en uploaded image moeten hetzelfde media-slot delen
- full-bleed sections mogen niet blind door theme wrappers boxed worden
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
