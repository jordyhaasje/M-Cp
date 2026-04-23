# MCP Remote Audit
Doelgroep: maintainers, developers en coding agents.

Status: levende audit en bron van waarheid voor de actuele MCP-toolingstatus.
Versie: 2026-04-23.
Laatst geverifieerd: 2026-04-23.

Deze audit is bewust compact gehouden. Onderstaande statusregels zijn de actieve samenvatting; de detailsecties blijven beschikbaar als achtergrond en moeten altijd aansluiten op code of recente productieobservatie.

## Compacte status
- Groen: de theme/section-pipeline (`plan-theme-edit`, `create-theme-section`, `patch-theme-file`, `draft-theme-artifact`) is gehard met planner-memory, verplichte reads, lokale preflight en verify-after-write.
- Groen: screenshot-only fallback, schema-preflight en refinement-recovery zijn bruikbaar voor normale stateless clients.
- Groen: screenshot-driven exact replicas bewaren nu ook langere plannerbriefing buiten de compacte `query`, zodat desktop/mobile-, screenshot- en exact-match-signalen niet meer verloren gaan in `description`- of summary-rijke prompts.
- Groen: de cross-theme acceptatiematrix dekt nu vier 2.0-theme archetypes voor prompt-only create, screenshot-only exact create, image-backed exact create, existing edit, template placement en native-block write/preview flows.
- Groen: `draft-theme-artifact mode="edit"` ondersteunt nu zowel `templates/*.json` als `templates/*.liquid`; JSON templates blijven JSON-valideren en Liquid templates krijgen Liquid safety-inspectie.
- Groen: `plan-theme-edit` geeft native-block architectuur nu ook door via `plannerHandoff`, en `draft-theme-artifact` valideert native-block snippets nu tegen gerelateerde section-schema’s, blank-safe optionele resources en `@theme` block-routes, zonder Shopify-onjuiste `name`-eisen op `@app`/`@theme` schema entries af te dwingen.
- Groen: MCP domeinfouten komen nu protocolcorrect terug als `isError: true`, en read/search/verify vereisen nu een expliciet of sticky bevestigd theme target.
- Groen: de hero-wrappercontractlaag is vóór Batch E extra gehard. `requiresThemeWrapperMirror` volgt nu de afgeleide hero-shell-familie in plaats van representatieve `heroLike`-context, en de validator blokkeert nu ook media-first/full-bleed heroes waarvan de media-shell effectief boxed raakt via inner `page-width`, `container` of `section-properties`.
- Groen: non-theme contract cleanup is aangescherpt voor refunds, product-contracten, tracking-redirects, destructieve auditsporen en eerste productimports.
- Groen: de license-service herkent Railway-productie nu expliciet, valideert verplichte productie-envs hard en beschermt backup-export/smoke checks beter zonder startup op Railway te blokkeren wanneer backup-export bewust niet is geconfigureerd.
- Groen: live Railway parity voor `Hazify-MCP-Remote` is opnieuw bevestigd via Railway deployment `b592ad92-07a4-4f7d-9ecf-6d3259cd48b4`, logreview en `npm run release:postdeploy` op 2026-04-23. De live smoke bleef tegelijk ook groen voor `Hazify-License-Service`.
- Geel: docs-drift is afgebakend; auto-sync geldt alleen voor `AGENTS.md` en `docs/02-SYSTEM-FLOW.md`.

## Verificatie- en release-ledger
| Service | Laatst lokaal geverifieerd | Laatste lokale bewijsset | Laatst live op Railway | Live parity bevestigd |
| --- | --- | --- | --- | --- |
| `Hazify-MCP-Remote` | 2026-04-23 | `npm run release:preflight`, inclusief `check:docs`, `check:repo`, build, repo-brede tests, e2e, plus gerichte matrix/regressies voor `crossThemeAcceptanceMatrix`, `draftThemeArtifact`, de nieuwe media-first hero-checks, Batch D read-efficiency regressies en Liquid template placement | `b592ad92-07a4-4f7d-9ecf-6d3259cd48b4` op 2026-04-23 | Ja. Railway deploy is succesvol, build/runtime logs tonen een normale startup met alleen bekende niet-blokkerende warnings, en `npm run release:postdeploy` is groen. |
| `Hazify-License-Service` | 2026-04-23 | meegenomen in `npm run release:preflight` en live smoke via `npm run release:postdeploy` | `b9c84b4e-9aa5-48dc-973b-f1c157b00146` op 2026-04-22 | Ja. De crash op `81578f9a-b774-4126-90f1-1eb12f9ac0b2` is opgelost; de service bleef in de 2026-04-23 smoke-run ook groen. |

Releasewaarheid:
- Lokaal groen betekent alleen dat de code en tests in deze repo op 2026-04-23 kloppen.
- Live groen betekent pas iets nadat de relevante service is gepusht, gedeployed op Railway, gesmoked via `npm run smoke:prod` en gecontroleerd in Railway logs.
- Op 2026-04-23 voldoet de huidige live stand daaraan voor beide services. De smoke bevatte live 200's op `/health`, `/v1/session/bootstrap` en de MCP well-known endpoints; `/v1/admin/readiness` en `/v1/billing/readiness` zijn in die run eerlijk als optioneel overgeslagen gemeld omdat de benodigde lokale keys/envs niet waren gezet.
- `npm run check:git-sync` blijft een git-parity check; dit bewijst geen Railway deploy parity.

De detailsecties hieronder zijn achtergrondcontext. Voor actuele status, blockers en de actieve leesvolgorde zijn de compacte status en de canonieke vervolgdocs leidend.

## Externe waarheid
Deze audit is expliciet getoetst aan externe documentatie:

- Shopify Liquid docs bevestigen dat Liquid niet wordt gerenderd binnen `{% stylesheet %}` en `{% javascript %}`.
  Bron: <https://shopify.dev/docs/api/liquid/tags/stylesheet>, <https://shopify.dev/docs/api/liquid/tags/javascript>
- Shopify Liquid docs bevestigen dat `block.shopify_attributes` editor-data-attributen levert en buiten de theme editor geen waarde teruggeeft.
  Bron: <https://shopify.dev/docs/api/liquid/objects/block>
- Shopify Liquid docs bevestigen dat Shopify-images canoniek via `image_url` plus `image_tag` horen te lopen, dat `image_url` een expliciete `width` of `height` verwacht, en dat `image_tag` standaard width/height-attributen mee kan geven.
  Bron: <https://shopify.dev/docs/api/liquid/filters/image_url>, <https://shopify.dev/docs/api/liquid/filters/image_tag>
- Shopify Liquid docs bevestigen dat `content_for 'blocks'` de aangewezen renderzone is voor theme blocks en dat `content_for 'block'` een statisch block van een gegeven type/id rendert.
  Bron: <https://shopify.dev/docs/api/liquid/tags/content_for>
- Shopify theme docs bevestigen dat snippets via `render` named parameters ontvangen, buiten de theme editor blijven, en dat LiquidDoc parameter-validatie en toolfeedback toevoegt voor snippets en blocks.
  Bron: <https://shopify.dev/docs/storefronts/themes/architecture/snippets>, <https://shopify.dev/docs/storefronts/themes/tools/liquid-doc>
- Shopify theme docs bevestigen dat sections en theme blocks app/theme blocks ondersteunen via generieke schema entries zoals `{ "type": "@app" }` en `{ "type": "@theme" }`, plus `content_for 'blocks'` of `{% render block %}` voor rendering.
  Bron: <https://shopify.dev/docs/storefronts/themes/architecture/blocks/app-blocks>, <https://shopify.dev/docs/storefronts/themes/architecture/blocks>, <https://shopify.dev/docs/storefronts/themes/architecture/blocks/ai-generated-theme-blocks>
- Shopify Liquid docs bevestigen dat `section.id` dynamisch kan zijn voor JSON-template sections.
  Bron: <https://shopify.dev/docs/api/liquid/objects/section>
- Shopify Admin docs bevestigen dat alleen `ThemeRole.MAIN` uniek is.
  Bron: <https://shopify.dev/docs/api/admin-graphql/latest/enums/ThemeRole>
- Shopify Admin docs bevestigen dat `productCreate` alleen de initiële variant ondersteunt en dat extra varianten via `productVariantsBulkCreate` horen te lopen.
  Bron: <https://shopify.dev/docs/api/admin-graphql/latest/mutations/productVariantsBulkCreate>
- Shopify Admin docs bevestigen dat `refundCreate` in `2026-04` een verplichte `@idempotent` directive vereist.
  Bron: <https://shopify.dev/docs/api/admin-graphql/latest/mutations/refundCreate>
- Context7 voor de MCP TypeScript SDK bevestigt dat tool-level failures als `isError: true` moeten worden teruggegeven en dat output-schema-validatie dan wordt overgeslagen.
  Bron: `/modelcontextprotocol/typescript-sdk`, docs `server.md` en `client.md`

## Huidige hoofdconclusie
De remote MCP is nu het sterkst op de theme/section-stack. `plan-theme-edit`, `create-theme-section`, `patch-theme-file` en `draft-theme-artifact` vormen samen een serieus geharde pipeline met planner-memory, verplichte reads, lokale inspectie, linting en verify-after-write.

De grootste resterende risico’s zitten nu vooral in:
- semantische layout- en archetype-fidelity buiten de nu geharde media-first/full-bleed hero-familie, vooral voor review/video/PDP/blocks en bredere prompt-only flows
- validators die wrapper-, media-slot- en Theme Editor-contracten nog niet overal hard genoeg afdwingen buiten de exacte media-first hero-fix
- audit- en docs-drift buiten de auto-gesynchroniseerde toolcatalogus
- niet-blokkerende Railway hygiene-signalen zoals `punycode` deprecation en `npm warn config production`

## Fase-1 auditinventaris voor Shopify theme generation
Deze inventaris legt de actuele fase-1 audit structureel vast voor vervolgwerk. Het doel is niet om elk bestand uitputtend te documenteren, maar om de relevante theme-tooling en verantwoordelijkheden helder te groeperen.

### Screenshot-interpretatie en archetype-selectie
- `apps/hazify-mcp-remote/src/lib/themeSectionContext.js`
  - inferentie van `category`, `sectionBlueprint.archetype`, reference signals, theme wrapper hints en scale guardrails
- `apps/hazify-mcp-remote/src/lib/themePlanning.js`
  - vertaalt template/section/snippet-analyse naar `recommendedFlow`, `nextReadKeys`, `nextWriteKeys`, `sectionBlueprint` en planner-handoff
- `apps/hazify-mcp-remote/src/tools/planThemeEdit.js`
  - publieke planner-ingang voor `new_section`, `existing_edit`, `native_block` en `template_placement`

### Section-creatie, editflow en guarded writes
- `apps/hazify-mcp-remote/src/tools/createThemeSection.js`
  - nieuwe standalone sections, planner-memory, exact required reads, veilige create->edit follow-up recovery
- `apps/hazify-mcp-remote/src/tools/patchThemeFile.js`
  - kleine single-file literal patches met exacte anchor- en readvereisten
- `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
  - kern van create/edit inspectie, preview-write, schema/Liquid/media checks en verify-after-write

### Block- en native-block flows
- `apps/hazify-mcp-remote/src/lib/themePlanning.js`
  - detectie van section block loops, snippet renderers, `@theme`/`content_for 'blocks'` routes en multi-file noodzaak
- `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
  - validatie van related schema refs, native block renderer contracts, block media safety en `blocks/*.liquid` eisen

### Schema-, Liquid- en Theme Editor-validatie
- `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
  - verplichte schema fields
  - range-validatie en step-count limieten
  - raw `<img>` checks
  - blank-safe optionele media
  - exact-match fidelity checks
  - Theme Editor warnings rond `block.shopify_attributes`

### Read/search/preview/apply infrastructuur
- `apps/hazify-mcp-remote/src/lib/themeReadHydration.js`
- `apps/hazify-mcp-remote/src/lib/themeEditMemory.js`
- `apps/hazify-mcp-remote/src/lib/themeFiles.js`
- `apps/hazify-mcp-remote/src/tools/getThemeFile.js`
- `apps/hazify-mcp-remote/src/tools/getThemeFiles.js`
- `apps/hazify-mcp-remote/src/tools/searchThemeFiles.js`
- `apps/hazify-mcp-remote/src/tools/verifyThemeFiles.js`
- `apps/hazify-mcp-remote/src/tools/applyThemeDraft.js`

## Fase-1 confirmed issues en structurele gaten
### Architectuur en screenshot-interpretatie
- Fase 1 identificeerde het ontbreken van first-class hero-archetypen voor:
  - `hero_media_first_overlay`
  - `hero_split_layout`
  - `hero_boxed_shell`
  - `hero_full_bleed_media`
- Die plannerlaag is nu hersteld: `themeSectionContext` en `plan-theme-edit` onderscheiden deze archetypen nu expliciet en geven daarnaast `layoutContract` plus `themeWrapperStrategy` mee in `sectionBlueprint` en `plannerHandoff`.
- Theme conventions en section archetypes zijn nog niet scherp genoeg losgetrokken:
  - theme conventions bepalen welke wrappers/helpers/classes beschikbaar zijn
  - het archetype bepaalt of de outer shell full-bleed, boxed, split-layout of media-first hoort te zijn
- Die scheiding is in de planner nu expliciet gemaakt via aparte blueprintlagen voor shell/media-architectuur versus wrapper/helper-mirroring.
- Batch B heeft nu harde validatorguardrails toegevoegd voor exacte media-first heroes die onterecht een outer `.container` of `page-width` krijgen.
- Batch B heeft nu ook harde validatorchecks voor exacte media-first heroes waarbij fallback-media en merchant-uploaded media niet exact hetzelfde primaire media-slot en dezelfde wrapper-hiërarchie delen.
- De pre-Batch-E hero-wrapper hardening trekt die lijn nu ook contractmatiger door:
  - `requiresThemeWrapperMirror` wordt niet meer vanuit representatieve `heroLike` afgeleid voor media-first/full-bleed heroes
  - prompt-only en screenshot-driven unboxed hero-shells houden hun outer media bounds
  - validators blokkeren nu ook “effectively boxed media” wanneer theme wrappers de media-shell alsnog omsluiten

### Shopify / schema / Liquid / Theme Editor
- Range settings met te veel discrete stappen blijven een echte foutklasse in gegenereerde output; de validator onderschept dit nu wel.
- Missende `label`-velden in section/block settings blijven een echte foutklasse in gegenereerde output; de validator onderschept dit nu wel.
- Raw `<img>` in plaats van `image_url | image_tag` blijft inhoudelijk een generation risk. Batch B blokkeert nu ook raw Shopify-media `<img>` wanneer de src via `image_url`/`img_url` uit Liquid komt, ook als width/height al aanwezig zijn.
- Ontbrekende `block.shopify_attributes` is niet langer alleen warning-only in de relevante section/snippet block-render contexts; Batch B maakt dit daar nu een harde validatorfail.
- `video_url` versus `video` is nu strikter: hosted `<video>`/`video_tag` markup met alleen schema type `video_url` faalt hard, terwijl externe embedflows met `video_url` wel toegestaan blijven.
- Wrapper/helper-logica is aantoonbaar minder asymmetrisch voor exacte media-first heroes, maar buiten die flows blijft wrapper-correctheid deels theme-aware guidance.

### Validatiegaten
- Exacte media-first hero-validatie dekt nu hard af:
  - media-first versus split-layout DOM-mismatch
  - onterechte outer `page-width` / `.container`
  - een media-shell die alsnog boxed raakt door een inner `page-width`, `container` of `section-properties` wrapper
  - gedeeld media-slot tussen fallback en uploaded image
- Wat nog niet universeel hard afgedwongen is:
  - het volledige `media layer -> overlay layer -> content layer` contract buiten exacte media-first/reference-driven flows
  - bredere background-media versus inline-image checks voor generieke prompt-only hero/video generation
- De acceptatiesuite bewijst nog geen echte full-bleed media-first hero. De huidige exact-reference fixture blijft een boxed split-shell voorbeeld.

## Fase-1 validatorstatus: sterk versus nog niet afgedwongen
### Al sterk afgedekt
- verplichte schema fields zoals `label`, `type`, `id`, `name` en `content`
- range bounds, step-alignment, te veel stappen en te weinig stappen
- blank-safe optionele `image_picker`, `video` en `video_url` rendering
- precision-first exact-match checks voor decoratieve anchors, sterren, vergelijking-iconografie, viewport parity, nav buttons en double-shells
- native-block schema/snippet drift en `@theme` block-route validatie

### Nog niet hard genoeg
- first-class hero/media archetype-correctheid buiten exact-match/reference-driven media-first flows
- volledige `media layer -> overlay layer -> content layer` contractvalidatie buiten exacte hero/media-fixes
- archetype-aware wrapperregels voor bredere review/video/blocks/PDP flows

## Concrete Shopify/theme fouten die fase 1 expliciet heeft bevestigd
- Productieruntime op Railway toonde op 2026-04-22 onder meer:
  - `sections/video-trust-header.liquid.schema.settings.overlay_opacity.label`
  - `section.settings.image_right_offset`
  - gecombineerde `ImgWidthAndHeight` en `ValidSchema` issues op `sections/jordy-header.liquid`
- De test- en code-audit bevestigt daarnaast structureel:
  - `block.shopify_attributes` was warning-only in fase 1 en is in Batch B nu hard fail gemaakt voor relevante section/snippet block-renderers
  - hero-archetype-collapsing naar `hero_banner` was een reële plannerfout in fase 1 en is nu op plannerniveau afgedekt met first-class hero-archetypen
  - raw Shopify-media `<img>` met width/height glipte in fase 1 nog door en wordt nu in Batch B hard geblokkeerd wanneer de src via `image_url`/`img_url` uit Liquid komt
  - acceptance coverage zonder echte media-first full-bleed hero-case

## Structurele regels voor vervolgwerk
Deze regels zijn na fase 1 expliciet leidend als referentie voor verdere implementatie, ook waar de code ze nog niet volledig afdwingt.

- Een hero-screenshot met content links en media visueel rechts mag niet automatisch naar split-layout degraderen.
- Voor media-first heroes hoort de canonieke architectuur te zijn:
  - hero shell
  - media layer
  - overlay layer
  - content layer
- Fallback en uploaded image moeten hetzelfde media-slot delen.
- Full-width hero shells mogen niet blind in `.container` of `page-width` terechtkomen.
- Theme wrappers/helpers moeten theme-aware worden toegepast zonder het section archetype te breken.
- Dezelfde foutklassen moeten niet alleen voor hero’s, maar ook voor review sections, video sections, blocks, prompt-only generation en bestaande edits worden beoordeeld.

## Wat al aantoonbaar goed werkt
- De server is registry-first opgezet met centrale tooldefinities, outputschema’s en aliassen in `apps/hazify-mcp-remote/src/tools/registry.js`.
- De runtime doet centrale auth/scope-gating en hydrateert Shopify lazy in `apps/hazify-mcp-remote/src/index.js`.
- `plan-theme-edit` geeft bruikbare handoff-data terug, inclusief `plannerHandoff`, `nextReadKeys`, `writeTool` en `sectionBlueprint`.
- `plan-theme-edit` en `themeSectionContext` onderscheiden nu ook first-class hero-archetypen voor `hero_media_first_overlay`, `hero_split_layout`, `hero_boxed_shell` en `hero_full_bleed_media`, inclusief aparte `layoutContract`- en `themeWrapperStrategy`-lagen in `sectionBlueprint` en `plannerHandoff`.
- Batch C heeft daar nu ook een expliciete change-scope classifier bovenop gezet: `micro_patch`, `bounded_rewrite`, `multi_file_structural_edit` en `net_new_generation`, inclusief `preferredWriteMode` en `diagnosticTargets` in plannerresultaten en `plannerHandoff`.
- Batch D heeft de readflow nu strikter metadata-first gemaakt:
  - `get-theme-file` hydrateert zonder expliciete `includeContent` alleen nog content voor exacte planner-required single-file reads
  - `get-theme-files` hydrateert alleen nog automatisch content wanneer de gevraagde keyset exact overeenkomt met de planner `nextReadKeys`
  - metadata-only batch-reads strippen defensief `value`, `attachment` en `url`
- Batch D maakt de planner ook tokenzuiniger:
  - surgical existing-edits lezen niet meer standaard renderer-snippets volledig in
  - templatekeuze gebeurt eerst metadata-first; alleen het gekozen template wordt daarna met content gehydrateerd
  - compacte snippet-search overfetcht minder agressief dan voorheen
- De pre-Batch-E hero-wrapper hardening voegt daar geen extra read-cost aan toe:
  - de hero-shell-familie wordt afgeleid uit bestaande plannerinput (`query`, `archetype`, `qualityTarget`)
  - de nieuwe boxed-media-shell validator werkt volledig op lokaal gegenereerde Liquid/CSS-markup en gebruikt geen extra theme reads
- Batch D heeft daarnaast de full-content read-memory strakker gemaakt:
  - verlopen volledige filecontent wordt actief uit `themeEditMemory` opgeschoond
  - full-content reads krijgen een kortere TTL dan algemene flow-memory, standaard ongeveer 45 minuten via `HAZIFY_MCP_THEME_EDIT_MEMORY_CONTENT_TTL_MS`
- Shopify Dev MCP en Context7 bevestigen deze richting:
  - Shopify theme-surfaces zoals `sections`, `snippets`, `blocks` en `templates` zijn aparte implementatie-oppervlakken en hoeven dus niet standaard allemaal full-content mee in één plannerpass
  - de MCP SDK-richtlijn blijft metadata/`structuredContent`-first voor tooloutputs; grote filebodies horen alleen mee te komen wanneer een vervolgstap daar echt op leunt
- `plan-theme-edit` geeft voor native-block flows nu ook architectuur terug in `plannerHandoff`, zoals `primarySectionFile`, `usesThemeBlocks`, `snippetRendererKeys` en `hasBlockShopifyAttributes`.
- `create-theme-section` kan verplichte planner-reads zelf hydrateren en kan alleen in een smalle, bewezen vervolgsituatie create veilig omzetten naar edit.
- `patch-theme-file` is nu de feitelijke kleine existing-edit route voor exacte single-file fixes.
- `patch-theme-file` geeft bij scope-fouten en ambigue/no-match anchors nu ook machine-leesbare repairdata terug, waaronder `changeScope`, `preferredWriteMode`, `diagnosticTargets` en een concrete `alternativeNextArgsTemplates.patchRetry`.
- `draft-theme-artifact` bevat sterke preflight-guardrails voor delimiterfouten, schema-validatie, range-defaults, step-alignment, presets, richtext defaults, `color_scheme`-compatibiliteit, parser-onveilige JS/Liquid-mixen en verify-after-write.
- `draft-theme-artifact` classificeert patch- en rewrite-failures nu ook explicieter voor small-patch flows: responses leiden `changeScope`, `preferredWriteMode` en `diagnosticTargets` af uit errors, next args en plannercontext, zodat vervolgpatches minder heuristisch hoeven te gokken.
- De delimiter-preflight is nu ook embedded-code-safe: bare `}}` of `%}` uit inline CSS/JS, zoals keyframes of compacte animaties, veroorzaken niet langer vals-positieve `inspection_failed_liquid_delimiter_balance` fouten, terwijl echte ongesloten Liquid-openers in dezelfde blokken wel blijven falen.
- De planner behandelt constrained responsive edits op bestaande files nu strikter als patch-flow: prompts zoals “alleen op mobiel”, “desktop ongewijzigd” en “behoud bestaande animatie” sturen niet meer onnodig naar een rewrite.
- Exact-match review/trustpilot replica’s herkennen nu desktop/mobile references robuuster, spiegelen wrapper-signalen ook wanneer het doeltheme vooral via `section-properties` werkt, en markeren dubbele outer shells niet meer alleen voor comparison tables maar ook voor bounded review/card-composities.
- Theme-scale inspectie gebruikt nu naast losse maxima ook een composietdruk op font-size, padding, gaps en sticky compositie, zodat sections die “net overal iets te groot” zijn niet meer onterecht door de create-flow glippen.
- Decoratieve inline SVG-iconen zoals sterren en quote marks veroorzaken niet meer standaard een generieke `image_picker` warning; alleen echte image/video/resource-markup telt daar nu nog voor mee.
- `draft-theme-artifact` controleert native-block snippets nu ook tegen het gerelateerde section-schema: nieuwe block types en `block.settings.*` refs moeten echt bestaan, onveilige optionele block-media worden teruggestuurd, `@theme`/`content_for 'blocks'` routes vereisen een echt `blocks/*.liquid` bestand, en `@app`/`@theme` blocks in section-schema’s worden nu Shopify-conform niet meer onterecht op `name` afgekeurd.
- Screenshot- en reference-driven flows zijn inhoudelijk veel sterker dan eerder: de planner en validator begrijpen nu precision-first signalen zoals decoratieve anchors, media shells, responsive parity en screenshot-only fallbackstrategieën, en de suite bewijst nu ook volledige screenshot-only en image-backed create/writes over vier archetypes.
- De huidige lokale verificatie is groen: `npm run release:preflight` slaagt op 2026-04-23 inclusief `check:docs`, `check:repo`, build, workspace-tests en `test:e2e`. Daarbovenop bewijzen de gerichte Batch D-regressies dat planner-aware metadata-reads, exact-match batch hydration en de slankere existing-edit planning blijven werken.
- Shopify Dev MCP `validate_theme` heeft daarnaast representatieve tijdelijke theme-fixtures groen gevalideerd voor zowel section/snippet exact-reference flows als native-block files (`sections/main-product.liquid`, `snippets/product-info.liquid`, `blocks/review-badge.liquid`).
- Tool-level domeinfouten worden nu als echte MCP tool errors teruggegeven: `apps/hazify-mcp-remote/src/index.js` leidt `isError` direct af van `success === false`, conform de MCP SDK-richtlijn.
- Theme reads/searches/verifies doen geen stille `main`-fallback meer; zonder expliciet of sticky bevestigd target komt nu een gedeelde `explicit_theme_target_required` repair response terug.
- `refund-order` gebruikt nu `refundCreate(input: $input) @idempotent(key: $idempotencyKey)` en genereert deterministische idempotency keys wanneer de client er geen meestuurt.
- `update-product` weigert de oude no-op velden `collectionsToJoin`, `collectionsToLeave` en `redirectNewHandle`.
- `update-order` schrijft geen tracking meer via `tracking`, `customAttributes` of `metafields`; de tool stuurt callers nu gestructureerd naar `set-order-tracking` of `update-fulfillment-tracking`.
- `get-order-by-id` houdt fulfillments als bron van waarheid en zet legacy tracking-signalen alleen nog in een expliciet gedepricieerde read-only substructuur.
- `delete-product` en `delete-product-variants` schrijven nu een persistente auditlog naar PostgreSQL en geven `auditLogId`, `requestId`, `tenantId`, `shopDomain` en target IDs terug.
- `clone-product-from-url` accepteert in eerste import-pass alleen nog `DRAFT` of `ARCHIVED`.
- Repo-brede verificatie op 2026-04-23 is groen: `npm run release:preflight`, inclusief `check:docs`, `check:repo`, build, workspace-tests en `npm run test:e2e`.

## Productiebewijs uit Railway
De laatste gecontroleerde productie-deploy van `Hazify-MCP-Remote` is `b592ad92-07a4-4f7d-9ecf-6d3259cd48b4` op 2026-04-23. Voor `Hazify-License-Service` is de laatste gecontroleerde success-deploy `b9c84b4e-9aa5-48dc-973b-f1c157b00146` op 2026-04-22.

De logs laten een realistisch beeld zien:
- de planner-, read- en write-pipeline wordt actief gebruikt op echte shops
- de validator blokkeert daadwerkelijk fouten zoals `inspection_failed_liquid_delimiter_balance`
- schemafouten zoals ongeldige range-defaults worden daadwerkelijk onderschept
- er komen nog echte parse- en schemafouten terug op section-creatie en op bestaande product-sections
- Railway bevestigde op 2026-04-22 ook een echte bestaande-section foutketen op `sections/hero-v1.liquid`: eerst `inspection_failed_truncated`, daarna `inspection_failed_liquid_delimiter_balance`. Dat incident is lokaal gereproduceerd en nu afgedekt met regressies voor mobile-only CSS-patches op bestaande sections met inline animatie-CSS.

Conclusie uit productie: de pipeline grijpt wel degelijk in en de huidige live Railway runtime sluit nu aan op de lokale remediation van 2026-04-23, inclusief de fix voor bestaande mobile-only section-edits met inline animatie-CSS, de bredere desktop/mobile exact-match heuristieken, de review-wall double-shell guard, de composiet theme-scale check, de nieuwe Batch B-validatoren rond raw Shopify-media `<img>`, `block.shopify_attributes`, hosted video-setting mismatch en exacte media-first hero-shells, plus Batch D-hardening voor metadata-first theme reads, exact-match planner hydration en kortere full-content memory-retentie. De recente build/runtime logs tonen alleen bekende niet-blokkerende waarschuwingen zoals `npm warn config production`, een `punycode` deprecation en een 0.0.0.0-bindingswaarschuwing. De eerdere license-service crash op ontbrekende `BACKUP_EXPORT_*` startup-validatie is opgeheven; backup-export blijft nu feature-gated op de admin-route in plaats van de hele service omver te trekken.

## Open blockers
- `[P1] Docs-drift wordt nog niet volledig automatisch tegengehouden.`
  `scripts/generate-tool-docs.mjs` synchroniseert alleen `AGENTS.md` en `docs/02-SYSTEM-FLOW.md`. `docs/03-THEME-SECTION-GENERATION.md`, `docs/04-MCP-REMOTE-AUDIT.md`, `docs/05-REMEDIATION-PLAN.md` en `apps/hazify-mcp-remote/README.md` blijven handmatig en daardoor driftgevoelig.

- `[P3] Railway build/start hygiene heeft nog niet-blokkerende waarschuwingen.`
  De huidige live deploys starten goed, maar de logs tonen nog `npm warn config production Use --omit=dev instead` en de `punycode` deprecation warning. Dat is geen functionele blocker meer, wel een ops-hygiene track.

## Wat we nu nog niet eerlijk mogen claimen
We mogen nu nog niet claimen dat:

- elke MCP-client automatisch perfecte sections kan maken op elk Shopify 2.0 theme
- screenshot- of image-driven replica’s op elk willekeurig Shopify 2.0 theme universeel exact en zonder handmatige nabehandeling slagen
- alle non-theme tools volledig contractvast en audit-proof zijn

De reden is niet dat de pipeline zwak is, maar dat "perfect op elk theme" nog steeds een grotere claim is dan het huidige acceptatiebewijs. Live Railway parity is nu rond; verdere eerlijkheid zit vooral in docs-driftbeheersing en het scherp houden van de claimgrenzen.

## Wanneer we wél mogen claimen dat LLMs “perfecte sections” kunnen maken
Deze claim is pas verantwoord zodra alle onderstaande gates groen zijn:

1. `Protocol gate`
   Alle tool-level domeinfouten komen als `isError: true` terug, zodat ChatGPT, Claude en andere clients zichzelf correct kunnen herstellen.

2. `Theme target gate`
   Geen enkele theme read/search/verify/write doet nog een stille fallback naar live `main` als de gebruiker geen expliciet `themeId` of `themeRole` heeft opgegeven.

3. `Prompt-only section gate`
   Een gewone tekstprompt zonder referentiebeeld moet op meerdere theme-archetypes een volledige, merchant-editable section opleveren die `preview_ready` haalt zonder handmatige code-edit.

4. `Screenshot-only replica gate`
   Een prompt met alleen een referentiescreenshot moet een section kunnen genereren die compositie, hiërarchie, spacing, anchors en responsief gedrag trouw volgt, ook als er geen losse bron-assets zijn.

5. `Image-backed exact-match gate`
   Een prompt met duidelijke referentie-afbeeldingen of assets moet een precision-first write opleveren die visueel en structureel dicht genoeg bij de referentie zit om zonder handmatige codefix te previewen en inhoudelijk te accepteren.

6. `Existing-edit gate`
   Bestaande section- en snippet-edits moeten met `search -> exact read -> patch/write` op alle ondersteunde themes zonder truncatie- of anchor-drift werken.

7. `Native block gate`
   Product-page blocks in snippet-zware themes moeten met dezelfde betrouwbaarheid slagen als standalone sections.

8. `Placement gate`
   Expliciete placement in `templates/*.json` of `templates/*.liquid` moet alleen op verzoek gebeuren, syntactisch geldig blijven voor het betreffende template-type, en hetzelfde expliciete theme-target behouden.

9. `Merchant-editability gate`
   Nieuwe sections en blocks moeten niet alleen renderen, maar ook zinvolle settings, veilige defaults en correcte Theme Editor-interactie bieden.

10. `Cross-theme gate`
    De hele matrix moet bewezen zijn op minimaal deze archetypes:
    - een Dawn-achtig standaard 2.0 theme
    - een wrapper-zwaar premium theme
    - een snippet-zwaar producttheme
    - een theme met veel app blocks / editor-complexiteit

11. `Production gate`
    Railway-logs mogen na de fixes geen terugkerend patroon meer tonen van dezelfde parse-, schema- of target-fouten voor deze flows.

## Verplichte fixtracks
### 1. Protocolcorrectheid
Status: afgerond op 2026-04-22.
- Corrigeer `isError`-gedrag in `apps/hazify-mcp-remote/src/index.js`.
- Voeg regressietests toe die afdwingen dat domeinfouten via MCP-resultaten als fouten terugkomen, niet als succes.

### 2. Strikt theme-targeting
Status: afgerond op 2026-04-22.
- Verwijder de impliciete `main`-fallback uit read/search/verify-routes.
- Retourneer in plaats daarvan een gestructureerde repair response die de client dwingt eerst een theme te kiezen.
- Laat alleen expliciet meegegeven `themeRole="main"` of `themeId` toe.

### 3. Theme-validator pariteit
Status: afgerond lokaal op 2026-04-22.
- Trek snippet-inspectie richting section/block-inspectie.
- Voeg extra checks toe voor snippet-zware native block flows, Theme Editor-contracten, resource guards en precision-first fidelity-signalen.
- Maak van echte productiefouten uit Railway vaste regressietests.
- Native-block planning stuurt nu ook compacter: helper-snippets zonder `section.blocks`-renderer vallen uit de eerste read-pass, de planner geeft compacte search-anchors terug en de write-template is patch-first in plaats van full-rewrite-first.

### 4. Cross-theme acceptatiesuite
Status: afgerond lokaal op 2026-04-22.
- Bouw een vaste acceptatiematrix voor prompt-only, screenshot-only, image-backed exact-match, existing-edit, native-block en template-placement flows.
- Meet niet alleen `preview_ready`, maar ook inhoudelijke kwaliteit, merchant-editability en theme-target-correctheid.
- De native-block acceptance-route bewijst nu expliciet `plan-theme-edit -> search-theme-files -> draft-theme-artifact patches[]`, inclusief server-side auto-hydratie van planner-reads zonder verplichte full `get-theme-files` dump.

### 5. Non-theme contract cleanup
Status: afgerond op 2026-04-22.
- Maak `refund-order` conform de actuele Shopify GraphQL-shape met idempotency.
- Verwijder of implementeer de extra `update-product` velden echt.
- Bouw legacy tracking in `update-order` af of maak het expliciet opt-in met duidelijke deprecation-output.
- Maak audit-redenen bij destructieve product-acties duurzaam zichtbaar.
- Blokkeer `clone-product-from-url` op `ACTIVE` totdat mediaverificatie aantoonbaar klaar is.

### 6. Docs en waarheidshygiëne
- Maak dit document leidend voor open blockers en acceptatiecriteria.
- Behandel `docs/05-REMEDIATION-PLAN.md` als voortgangs- en release-log en niet als definitieve auditwaarheid.
- Trek `docs/03-THEME-SECTION-GENERATION.md`, `apps/hazify-mcp-remote/README.md` en gegenereerde tooldocs na elke gedragswijziging meteen gelijk.

## Minimale testuitbreidingen
De recente suite dekt nu:

- domeinfouten die `result.isError === true` moeten opleveren
- read/search/verify zonder expliciet of sticky theme-target
- een geldige `refundCreate @idempotent` mutation-shape
- het weigeren van oude `update-product` contractvelden
- het blokkeren van `ACTIVE` in `clone-product-from-url`
- persistente auditlogging voor destructieve productacties

Optionele extra bewijslaag:

- een authenticated production MCP smoke met een expliciete production token, bovenop de anonieme well-known en `/mcp` smoke die nu al groen is

## Werkwijze voor volgende fixes
Gebruik dit document als auditbron, en gebruik `docs/05-REMEDIATION-PLAN.md` voor voortgang, release-gates en live bevestiging.

De aanbevolen uitvoervolgorde is:
1. protocolcorrectheid
2. theme-target-strictness
3. snippet/native-block parity
4. cross-theme acceptance suite
5. non-theme contract cleanup
6. docs-sync en productie-observability

## Onderhoudsregel
Als code en deze audit elkaar tegenspreken, is de code leidend. Werk deze audit dan in dezelfde wijziging bij, zodat de repo één actuele bron van waarheid houdt.
