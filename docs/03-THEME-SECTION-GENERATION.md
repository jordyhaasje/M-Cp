# Theme Section Generation
Doelgroep: repo maintainers, developers en coding agents.

Deze gids beschrijft de actuele waarheid voor screenshot-driven en text-only section/block generation in `@hazify/mcp-remote`.

## Scope
- Nieuwe standalone sections uit screenshots of tekst
- Bestaande section edits
- Native product-page blocks in bestaande sections/snippets
- Expliciete template placement op JSON- of Liquid-templates
- Veilig preview/apply gedrag zonder blind live placement

## Ondersteunde request-typen
- Hero banners
- Image/social strips
- Instagram/TikTok/social strips
- Review- en Trustpilot-sliders
- Image sliders / carousels
- Video sections
- Video sliders / carousels
- Logo walls / logo sliders
- FAQ / collapsibles
- Comparison tables
- Before/after sliders
- Featured product sections
- Featured collection sections
- Image-with-text, rich text, newsletter, tabs en custom promotional sections
- Product-page native blocks
- Bestaande section edits
- Nieuwe standalone sections
- Expliciete template placement
- Text-only / no-reference generatie

De planner representeert deze requests via `intent`, `qualityTarget`, `category` en `sectionBlueprint.archetype`. De validator- en write-pipeline blijft hetzelfde: betere promptclassificatie mag nooit safety checks verzwakken.

Theme-target waarheid:
- `themeRole` zonder `themeId` is alleen veilig voor `main`.
- Gebruik een exact `themeId` voor `development`, `unpublished` en `demo` themes, omdat Shopify alleen `MAIN` als uniek garandeert.
- Compatibility summaries mogen dus wel "development theme" noemen, maar de tools mogen daar geen role-only target uit afleiden.

## Canonical Flows
### Screenshot replica, nieuwe section
Gebruik wanneer de gebruiker een screenshot, referentiebeeld of termen als `exact`, `pixel-perfect`, `replica` of `match` geeft.

1. `get-themes` alleen als theme discovery nodig is; sla deze stap over als de gebruiker al een expliciet `themeId` of `themeRole` heeft gegeven
2. `plan-theme-edit` met `intent="new_section"` op het expliciete target theme
3. Lees exact `nextReadKeys` met `includeContent=true`
4. `create-theme-section`
5. Alleen bij bredere visuele refinements: `draft-theme-artifact mode="edit"` met volledige rewrite

Verwachte plannertruth:
- `qualityTarget = "exact_match"`
- `generationMode = "precision_first"`
- `completionPolicy.deliveryExpectation = "final_reference_match_in_first_write"`
- De planner bewaart naast de compacte `query` nu ook een langere analysetekst in de handoff, zodat desktop/mobile-, screenshot- en exact-match-signalen niet wegvallen als ze alleen in `description`, `_tool_input_summary` of later in een langere prompt staan.
- Geen baseline-first vraag of extra toestemming voor pixel-perfect styling
- Screenshot-only referenties zonder losse bron-assets mogen `previewMediaPolicy = "best_effort_demo_media"` gebruiken. Dan blijft de layout/styling precisie-first, maar mag de eerste write renderbare demo-media of een gestileerde media shell bevatten in plaats van een hard fail op placeholder-only media.
- Als de prompt wel expliciete bron-assets noemt, hoort de planner streng te blijven met `previewMediaPolicy = "strict_renderable_media"` en `requiresRenderablePreviewMedia = true`
- Als de referentie expliciet desktop en mobiel toont, hoort de planner `requiresResponsiveViewportParity = true` te signaleren.
- Als de referentie duidelijke decoratieve anchors noemt of toont, zoals floating productmedia, badges of seals, horen die anchors onderdeel van de eerste write te blijven en niet te degraderen naar een generieke baseline.
- Als de referentie een echte rating-strip of comparison-iconografie toont, moeten sterren en check/x/thumb-iconen in de eerste write ook herkenbaar blijven in plaats van generieke blokjes, cirkels of lege vakken.
- Voor bounded review walls, comparison cards en vergelijkbare shell-replica's hoort de pipeline dubbele background-shells te vermijden wanneer theme wrappers zoals `section-properties` al de outer surface of spacinglaag beheren.

Voorbeeldprompt:
```text
Maak deze Trustpilot review slider exact na van de screenshot als standalone section in theme 123.
```

### Text-only nieuwe section
Gebruik wanneer de gebruiker geen referentiebeeld geeft, maar wel een duidelijke beschrijving.

1. `get-themes` alleen als theme discovery nodig is; sla deze stap over als de gebruiker al een expliciet `themeId` of `themeRole` heeft gegeven
2. `plan-theme-edit` met `intent="new_section"`
3. Lees exact `nextReadKeys`
4. `create-theme-section`

Verwachte plannertruth:
- `qualityTarget = "theme_consistent"`
- Theme wrappers/helpers/scales worden gespiegeld uit representatieve theme files
- `plan-theme-edit` geeft voor nieuwe sections een compacte `generationRecipe` terug, zowel top-level als binnen `sectionBlueprint.generationRecipe`. Die recipe is de pre-generation waarheid voor de eerste write en bevat minimaal:
  - `sectionContractType`
  - `wrapperMode`
  - `allowedThemeHelpers`
  - `forbiddenWrapperCombinations`
  - `requiredBlockRenderingPattern`
  - `allowedAuxiliaryLoops`
  - `scaleProfile`
  - `desktopMobileLayoutRequirements`
  - `interactionPatternRequirements`
- Prompt-only review-, slider-, FAQ-, comparison-, logo-, video-, interactieve, featured collection- en PDP/product-prompts krijgen nu een `sectionBlueprint.promptContract` plus een generiek `sectionBlueprint.implementationContract` mee. Die contractlaag voorkomt dat een gewone tekstprompt degradeert naar een generieke heading/body/CTA section wanneer de prompt eigenlijk herhaalbare blocks, video-rendering, werkende interactiviteit, collection data of productcontext vraagt.
- Elke gegenereerde section met planner-blueprint hoort een aantoonbare desktop- én mobiele compositie te hebben. Dat mag via `@media`, `@container`, `clamp`, `minmax` of een vergelijkbaar responsive layoutpatroon, maar niet als impliciete afterthought.
- De generator moet de recipe volgen in plaats van zelf opnieuw wrapper- of schaalkeuzes te raden. `create-theme-section` voert een contract-aware preflight uit vóór de write en `draft-theme-artifact mode="create"` voert dezelfde checks nogmaals uit als backstop.

Voorbeeldprompt:
```text
Maak een comparison table section voor product voordelen met 3 kolommen en CTA.
```

### Bestaande section edit
Gebruik wanneer het doelbestand al bestaat of wanneer de gebruiker expliciet bestaande markup wil aanpassen.

1. `search-theme-files`
2. `get-theme-file`
3. `patch-theme-file` voor kleine letterlijke wijzigingen
4. `draft-theme-artifact mode="edit"` voor volledige rewrites of multi-file edits

Belangrijk:
- Zodra het doelbestand al bestaat, hoort de client niet opnieuw `create-theme-section` te kiezen maar over te schakelen naar `existing_edit`
- Als een gewone stateless client tóch nog een refine-prompt via `create-theme-section` op exact dezelfde net aangemaakte section stuurt, converteert de server die route nu veilig naar `draft-theme-artifact mode="edit"` zolang theme-target en recent file-context aantoonbaar hetzelfde blijven
- Kleine constrained responsive edits zoals “alleen op mobiel”, “desktop ongewijzigd” of een bestaande rating/CTA bovenaan zetten, horen nu expliciet in de `patch-theme-file` route en niet meer automatisch in een rewrite-flow
- Bij `patch_scope_too_large` moet de client eerst opnieuw `get-theme-file includeContent=true` doen op hetzelfde theme target. Pas daarna mag een preserve-on-edit full-file rewrite naar `draft-theme-artifact mode="edit"` worden gestuurd.
- Broad rewrites op bestaande grote files blijven beschermd door truncation en lossy-rewrite checks
- Gebruik `value` alleen als het volledige actuele bestand bewust is ingelezen en preserve-on-edit vervangen moet worden
- Gebruik in `files[].value` altijd echte volledige bestandsinhoud; context-placeholders, compacte reconstructies of samenvattingen zoals `REWRITE_ALREADY_APPLIED_IN_CONTEXT` zijn ongeldig
- Een full rewrite mag bestaande schema labels/settings, block types/settings, presets, `block.shopify_attributes`, `image_tag`-paden, accessibility/media-attributen, theme wrappers en scoped CSS niet verwijderen tenzij de gebruiker expliciet om verwijderen of versimpelen vraagt
- De lokale Liquid delimiter-check negeert nu bare `}}` en `%}` uit embedded CSS/JS, zoals keyframes of compacte scriptblokken, maar blijft echte ongesloten `{{` en `{%` in dezelfde file nog steeds blokkeren
- De generation-recipe preflight is bedoeld voor create-mode generated sections. Kleine bestaande edits, `patch-theme-file` en gewone `draft-theme-artifact mode="edit"` rewrites mogen daardoor niet gaan falen op nieuwe-section schaal- of recipe-contracten.

Voorbeeldprompt:
```text
Maak de bestaande reviews-showcase compacter en verander de kaart-gap op mobiel.
```

### Native product block
Gebruik wanneer de gebruiker een block in een bestaande productsection wil, bijvoorbeeld `main-product` of `product-info`.

1. `plan-theme-edit` met `intent="native_block"`
2. Volg in native-block flows eerst de planner `nextTool`: dat is nu bij voorkeur `search-theme-files` op exact `nextReadKeys`, zodat de client compacte schema/render-anchors ziet in plaats van volledige file dumps
3. Gebruik daarna `draft-theme-artifact mode="edit"` met `patch`/`patches`; de write-pipeline kan planner-reads server-side auto-hydrateren als de planner-handoff aanwezig blijft
4. Gebruik alleen nog een volledige read of `files[].value` rewrite als de architectuur echt breder is dan een block/schema patch

Belangrijk:
- Veel themes renderen product blocks via snippets
- Dit is meestal geen `blocks/*.liquid` create-flow
- Het planner-geselecteerde templatebestand hoeft na planning meestal niet opnieuw gelezen te worden tenzij placement expliciet gevraagd is
- Helper-snippets die wel in de section worden gerenderd maar geen `section.blocks`-renderer zijn, zoals losse prijs- of helper-snippets, horen niet meer standaard in de eerste planner-read pass te belanden
- Voor klassieke OS 2.0 productsections is de kleinste veilige wijziging meestal: section-schema patchen, block-rendering in de bestaande renderer-snippet patchen, en alleen bij echte `@theme`-architectuur naar `blocks/*.liquid` uitwijken

Voorbeeldprompt:
```text
Voeg een review badge native block toe aan de productpagina.
```

### Expliciete template placement
Nieuwe sections worden niet automatisch in templates geplaatst. Placement gebeurt alleen op expliciete gebruikersvraag.

1. Maak eerst de section
2. Daarna aparte `draft-theme-artifact mode="edit"` op het relevante `templates/*.json` of `templates/*.liquid` bestand

Voorbeeldprompt:
```text
Maak een hero-video section en plaats hem daarna ook op de homepage van theme 123.
```

## Archetype Notes
### Hero- en shell-archetypen (fase-1 auditreferentie)
Deze regels zijn de referentie voor vervolgwerk en remediation. De planner onderscheidt deze hero-archetypen nu first-class en geeft daarnaast `layoutContract` plus `themeWrapperStrategy` mee in `sectionBlueprint`. De validator handhaaft de hoogste-risico gevallen nu ook hard in `draft-theme-artifact`, vooral voor exacte media-first heroes, block wrappers en Shopify-media. Volledige archetype-pariteit buiten exact-match/media-first flows blijft vervolgwerk.

- De planner en validator moeten uiteindelijk first-class onderscheid kunnen maken tussen minstens:
  - `hero_media_first_overlay`
  - `hero_split_layout`
  - `hero_boxed_shell`
  - `hero_full_bleed_media`
- Een hero-screenshot met content links en media visueel rechts mag niet automatisch als split two-column layout worden geïnterpreteerd. Controleer eerst of de referentie eigenlijk één full-bleed media-oppervlak met overlay en daarboven content toont.
- Voor media-first heroes is de canonieke structuur:
  - outer hero shell
  - media layer
  - overlay layer
  - content layer
- Fallback-media en merchant-uploaded media moeten hetzelfde primaire media-slot en dezelfde wrapper-hiërarchie delen. Gebruik dus geen aparte DOM-architectuur voor placeholder/fallback versus geüploade media.
- Full-width media-first heroes horen geen outer `.container`, `page-width` of vergelijkbare bounded shell te krijgen tenzij de referentie aantoonbaar boxed is.
- Deze wrapperregel is nu hero-shell-family aware in plaats van screenshot-only:
  - `hero_media_first_overlay` en `hero_full_bleed_media` behandelen de media-shell als outer bounds
  - `hero_banner` mag alleen naar diezelfde unboxed familie doorvallen als de prompt/query echt wijst op edge-to-edge, background-media of text-over-image zonder boxed/split signalen
  - `hero_boxed_shell` en `hero_split_layout` houden juist hun bounded contract
- Theme conventions en section archetypes zijn twee aparte beslissingen:
  - theme conventions bepalen welke helpers, spacing-conventies, classes en wrappers beschikbaar zijn
  - het section archetype bepaalt of de outer shell full-bleed, boxed, media-first, split-layout of card-based hoort te zijn
- Gebruik in planner- en write-handoffs daarom ook expliciet de twee aparte blueprintlagen:
  - `layoutContract` voor shell-, media- en overlay-architectuur
  - `themeWrapperStrategy` voor theme-aware content-width, helperplaatsing en wrapper-mirroring
- Theme wrappers/helpers mogen daarom niet als blanket rule worden gespiegeld. Een helper zoals `section-properties` of een theme container kan wel op een inner content-laag thuishoren zonder dat de outer hero-shell boxed wordt.
- Voor media-first/full-bleed heroes geldt nu expliciet:
  - `requiresThemeWrapperMirror = false` voor de outer shell
  - theme helpers zoals `page-width`, `container` en `section-properties` mogen alleen op een inner content- of spacer-laag landen
  - de validator keurt niet alleen een boxed root af, maar ook een “effectively boxed” media-shell die alsnog in zo'n theme wrapper opgesloten zit
- Deze principes gelden niet alleen voor hero’s, maar ook voor review sections, video sections, media sections, blocks en bestaande edits waarbij dezelfde media/shell-keuzes opnieuw kunnen ontsporen.

### Social strips
- Queries zoals `Instagram strip`, `TikTok feed`, `social strip` of `UGC feed` moeten media-georiënteerd plannen
- Zonder sliderwoorden hoort dit meestal bij archetype `social_strip`
- Met `slider` of `carousel` hoort dit bij `social_slider`

### Video sections
- Gebruik schema type `video` voor merchant-uploaded Shopify video
- Gebruik `video_url` alleen voor externe embeds
- Interactieve video carousels vereisen Theme Editor lifecycle hooks en veilig pausestop-gedrag voor inactieve slides
- `video_section` en `video_slider` vallen nu ook onder een expliciete `media_surface` shell-familie:
  - hou de media-oppervlakte leidend
  - laat externe iframe/embed-routes alleen toe wanneer schema echt `video_url` aanbiedt
  - laat hosted Shopify-video alleen via type `video` + `video_tag` lopen
- Prompt-only `video_section` en `video_slider` flows moeten in de eerste write al een merchant-editable `video` of `video_url` setting en een blank-safe renderpad hebben. Een tekst-only baseline is geen geldig video-resultaat.

### Review, comparison en card-walls
- Exacte review- en comparison-replica's vallen nu onder een expliciete `bounded_card_shell` familie in plaats van een generieke content-section fallback.
- Die familie verwacht:
  - een bounded outer shell
  - een aparte inner card/panel/surface
  - theme wrappers alleen waar ze de bounded compositie ondersteunen
- Maak van review walls, testimonial grids en comparison shells dus geen vlakke full-width tekstsecties zonder kaartlaag wanneer de referentie duidelijk card-based is.
- Prompt-only review/testimonial sections zonder exact-reference vallen nu ook onder review-fidelity checks:
  - herhaalbare `schema.blocks` plus `section.blocks` renderer wanneer meerdere reviews gevraagd worden
  - `block.shopify_attributes` op de review-card wrapper
  - quote-, author/customer- en rating/sterren-signalen
  - een zichtbare card/panel/surface-laag in plaats van alleen richtext
- Review sliders en review grids zijn repeatable families: gebruik block-driven review cards met preset blocks. Een single testimonial card of rating badge mag settings gebruiken wanneer het contract expliciet niet-repeatable is.
- Review slider auxiliary UI hoort niet opnieuw over `section.blocks` te loopen. Gebruik één content-loop met `block.shopify_attributes`; genereer dots, bullets of pagination daarna via component-scoped JS op basis van de gerenderde slides of via non-block data.
- Review/card-wall schaal moet standaard theme-sized blijven. Content widths rond 1000px, review-card heights rond 300-360px, quote font maxima rond 30px en gaps onder circa 40px zijn de normale baseline tenzij de gebruiker expliciet om oversized, full-bleed of immersive vraagt.

### Wrapper modes en shells
Nieuwe section recipes gebruiken expliciet `wrapperMode`:
- `use_theme_section_properties`: theme helpers zoals `section-properties` beheren outer background/spacing; voeg geen tweede root background shell toe.
- `own_scoped_shell`: de section beheert zelf de outer visual shell; hou theme helpers neutraal en geef geen `background`/`text_color` door aan `section-properties`.
- `no_background_shell`: gebruik geen outer background shell; hou eventuele theme containers op een inner contentlaag wanneer dat bij het archetype past.

Algemene regel: één background shell is genoeg. Combineer geen `section-properties` background/text-color helper met een eigen root background surface. Impact-like themes mogen Impact-conventies blijven volgen, maar alleen wanneer de recipe en detectie aangeven welke laag de outer surface beheert.

### Commerce scaffold sections
- `native_block`, `pdp_section`, `featured_product_section` en bredere `commerce_section` flows vallen nu onder een expliciete `commerce_scaffold` familie.
- Behoud in zulke flows de bestaande product/PDP renderer scaffold van het theme:
  - vervang `product-info`, `buy_buttons`, prijshelpers of block-slots niet door losse marketing-markup
  - spiegel wrappers en helpers alleen voor zover ze de bestaande commerce-renderflow intact laten
- Prompt-only PDP/product en featured-product sections moeten een echte productbron gebruiken: de product-template context, een `product` setting of bestaande theme product helpers. Statische fake prijzen of fake add-to-cart markup zonder productbron falen vóór preview-write.

### Collection en repeatable editor contracts
- `featured_collection_section` en `collection_slider` moeten een echte collection-bron gebruiken: een `collection` setting of collection-template context. Een statische lijst met productkaarten is geen geldig eindresultaat.
- Herhaalbare contentfamilies moeten merchant-editable blijven in de Theme Editor:
  - sliders/carousels renderen slide blocks via `section.blocks`
  - FAQ/accordion sections renderen vraag/antwoord blocks, bij voorkeur met native `<details>/<summary>`
  - review/testimonial sections renderen review blocks met quote/body, author/customer en rating/sterren setting
  - comparison tables, logo walls/sliders en tabs gebruiken blocks of echte Shopify resource settings voor hun items
- Voor zulke repeatable families controleert de validator nu op `schema.blocks`, een `section.blocks` loop, `block.settings` output, `block.shopify_attributes` op de block-wrapper en preset blocks, zodat de editor niet leeg of statisch opent.

### Sliders en carousels
- Scope JS altijd per section instance
- Ondersteun Theme Editor events (`shopify:section:load`, `shopify:section:select`, `shopify:block:select`, `shopify:block:deselect`)
- Gebruik blank-safe media/link rendering
- Slider-achtige output zonder editable slide blocks en preset slide blocks is geen geldig generated-section resultaat, ook als de Liquid syntactisch klopt.
- Dots, bullets en pagination mogen geen tweede `section.blocks` loop zijn. De primaire slide/card loop is de enige loop die editor block wrappers draagt; auxiliary UI wordt uit rendered DOM, numeric ranges of non-block data opgebouwd.
- Hero sliders, review sliders, logo sliders, image sliders, video sliders en collection sliders hebben elk een eigen schaalprofiel. Gebruik niet blind hero-typography of hero-spacing voor card/review/content sliders.

### Safe link/media guards
- Guard optionele `href`, `src`, `poster`, `action` en `formaction`
- Guard optionele `image_picker`, `video` en `video_url` settings vóór `image_url`, `video_tag` of `external_video_*`
- `block.shopify_attributes` hoort op block wrappers in loops over `section.blocks`
- Gebruik voor Shopify image objects en merchant-editable imagery canoniek `image_url | image_tag`. Raw `<img>` hoort hier in principe niet thuis als hoofdpad voor theme generation.

## Live Versus Preview
- `draft-theme-artifact` kan `status="preview_ready"` teruggeven terwijl het doeltheme het live `main` theme is
- Dit is geen impliciete publish-flow; het betekent dat de preview write naar het expliciet gekozen target succesvol was
- De remote moet live-target risico expliciet blijven waarschuwen
- `preview_ready` en `applied` vereisen een geslaagde verify-after-write. Een `mismatch`, `missing` of verify-error blijft `preview_failed` of `apply_failed`.
- `theme_drafts` zijn shop-gebonden via `shop_domain`; `apply-theme-draft` mag een draft alleen toepassen binnen dezelfde gekoppelde Shopify shop.
- Cross-shop draft IDs falen met `theme_draft_shop_mismatch`.

## Stateless Client Notes
- Gewone chatclients zoals ChatGPT, Claude en Perplexity missen soms server-side sessiecontext tussen toolcalls
- Daarom retourneren create-conflicts nu expliciet een repair-sequence: `plan-theme-edit intent="existing_edit"` -> exacte read(s) -> `draft-theme-artifact mode="edit"`
- Full rewrites op bestaande bestanden moeten altijd het volledige nieuwe bestand meesturen; de MCP kan een placeholder-string nooit terugvertalen naar echte Liquid
- `patch_scope_too_large` retourneert daarom nu bewust `nextTool="get-theme-file"` met `includeContent=true`. De retry-template voor `draft-theme-artifact` is pas de stap daarna en verwacht de volledig bewerkte actuele filebody.
- Bij inspectiefouten zet de response expliciet `writeApplied=false`, `liveFileUnchanged=true` en `writeStatus="blocked_live_file_unchanged"` zodat clients weten dat een failed preflight het theme niet heeft gewijzigd.

## Read Semantics
- `get-theme-file` blijft nu standaard metadata-first wanneer `includeContent` ontbreekt.
- Alleen een exacte planner-required single-file read mag `includeContent` automatisch op `true` zetten, met een warning in de tooloutput.
- `get-theme-files` of `read-theme-files` zetten `includeContent` niet blind automatisch aan.
- Die auto-hydratie gebeurt alleen wanneer de gevraagde `keys` exact overeenkomen met de planner `nextReadKeys` op een compatibel theme-target.
- Voor alle andere batch-reads blijft `includeContent` standaard `false` tenzij de client het expliciet meegeeft.
- Metadata-only batch-reads strippen defensief `value`, `attachment` en `url`, ook als de onderliggende transportlaag die toch terugstuurt.
- `apply-theme-draft` is alleen voor promote/apply van een bestaande draft, nooit voor de eerste create-write

## Token-Efficiënte Flow
- Plan eerst, lees daarna alleen `nextReadKeys`
- Gebruik de compacte `generationRecipe` als generation prompt-contract. Dump geen extra volledige theme files om wrapperMode, repeatable blocks of scale opnieuw te raden.
- Gebruik `search-theme-files` voor compacte anchors
- `plan-theme-edit` leest nu minder eager full-content mee:
  - bestaande surgical existing-edits hydrateren niet meer standaard renderer-snippets
  - templatekeuze gebeurt eerst metadata-first; alleen het gekozen template wordt daarna met content gehydrateerd
- Native-block en andere patch-first editflows horen nu standaard via `search-theme-files` plus `patch`/`patches` te lopen; een volledige `get-theme-files includeContent=true` read is daar niet meer de voorkeursroute
- `plan-theme-edit` geeft nu ook expliciet terug welke wijzigingsscope bedoeld is:
  - `micro_patch` -> kleine bestaande-file wijziging via `patch-theme-file` of `draft-theme-artifact mode="edit"` met `patch`
  - `bounded_rewrite` -> volledige single-file rewrite via `draft-theme-artifact mode="edit"` met `value`
  - `multi_file_structural_edit` -> gecoördineerde `files[]`-edit over meerdere bestaande bestanden
  - `net_new_generation` -> nieuwe section of block-flow via `create-theme-section` of create-write
- Gebruik `preferredWriteMode` als tweede beslissingslaag wanneer een client stateless is of weinig sessiecontext heeft
- Gebruik `patch` / `patches` voor kleine bestaande-file edits
- Gebruik volledige rewrites alleen wanneer het doelbestand bewust volledig is ingelezen
- Full-content theme-read memory wordt nu sneller opgeschoond dan algemene flow-memory:
  - standaard ongeveer 45 minuten voor volledige filecontent via `HAZIFY_MCP_THEME_EDIT_MEMORY_CONTENT_TTL_MS`
  - theme-target, planner-handoff en andere lichtere sessiestate blijven onder de normale flow-TTL vallen
- Houd theme requests op maximaal 10 bestanden

## Patchbare Diagnostics
- Repair- en validatorresponses horen nu waar mogelijk `diagnosticTargets` terug te geven met:
  - `fileKey`
  - `path`
  - `preferredWriteMode`
  - `searchString`
  - `replaceString`
  - `anchorCandidates`
- Gebruik die targets als machine-leesbare brug tussen validate/planning en de uiteindelijke patch- of rewrite-call
- Ambigue of verlopen literal patch-anchors horen niet alleen een tekstuele fout te geven, maar ook concrete `anchorCandidates` uit de laatst bekende exacte file-read
- `patch-theme-file` mag bij anchor-fouten daarnaast een `alternativeNextArgsTemplates.patchRetry` teruggeven, zodat een client de retry direct kan richten zonder opnieuw breed te moeten plannen

## Validation Truth
- Schema JSON moet geldig zijn
- Verplichte schema-velden zoals setting/block `label`, `type`, `id`, `name` en `content` waar relevant moeten al in lokale inspectie slagen, niet pas in `theme-check`
- Range settings moeten binnen min/max en step-grid vallen
- `video_section` en `video_slider` moeten nu ook hard falen wanneer:
  - een externe iframe/embed-render geen `video_url` setting heeft
  - video-rendering helemaal geen `video` of `video_url` schema-pad heeft
- `blocks/*.liquid` moeten nu ook hard falen wanneer:
  - `block.shopify_attributes` op de block-wrapper ontbreekt
  - buiten schema/doc/style/javascript geen renderbare block-markup aanwezig is
- Exacte review/comparison card-surfaces moeten nu ook hard falen wanneer:
  - de bounded shell ontbreekt
  - de inner card/panel surface ontbreekt
- Prompt-only review/testimonial sections falen nu ook wanneer review-signalen, herhaalbare block cards, rating/quote-signalen of een review-card/panel surface ontbreken.
- Prompt-only video sections falen nu wanneer een `video`/`video_url` setting of renderbaar blank-safe video-pad ontbreekt.
- Prompt-only PDP/product en featured-product sections falen nu wanneer een productbron of commerce action/helper ontbreekt.
- Prompt-only featured collection/collection-slider sections falen nu wanneer een collection source ontbreekt.
- Repeatable section families zoals sliders, FAQ, reviews/testimonials, comparison rows, logo walls/sliders en tabs falen nu wanneer ze geen editor-bruikbare blockstructuur, block-rendering of preset blocks hebben.
- Generated sections met een planner-blueprint falen nu wanneer er geen expliciete desktop/mobile responsive behavior detecteerbaar is. Responsive detectie mag intrinsiek zijn: `@media` is geldig, maar `@container`, `clamp()`, `minmax()`, `auto-fit/auto-fill`, `flex-wrap`, responsive grid/flex tracks en duidelijke mobile/desktop CSS variables tellen ook.
- Generated sections met een `generationRecipe` falen in create-mode wanneer:
  - `wrapperMode` wordt geschonden
  - `section.blocks` opnieuw wordt geloopt voor dots/pagination in plaats van alleen voor content blocks
  - het theme een content-width wrapper gebruikt en de generated section die wrapper mist
  - schema defaults of CSS voor content width, card min-height, quote/font size, gap of card padding duidelijk boven het archetype-scale-profiel zitten
- Scale profiles bestaan voor `hero_banner`, `hero_slider`, `review_slider`, `review_section`, `faq`, `video`, `featured_product`, `featured_collection`, `comparison_table`, `logo_slider` en `content_section`. Ze worden gecapped door de representatieve theme scale wanneer die kleiner is, tenzij de prompt expliciet oversized/full-bleed/immersive vraagt.
- Raw `<img>` met Shopify `image_url`/`img_url` als src horen hard te falen; gebruik daar `image_url | image_tag`
- `block.shopify_attributes` hoort hard aanwezig te zijn op gedeelde block wrappers in loops over `section.blocks` en native block-render snippets. Een attribuut buiten de relevante loop-body telt niet.
- Hosted `<video>`/`video_tag` markup met alleen schema type `video_url` hoort hard te falen; gebruik `video` voor merchant-uploaded video en `video_url` voor externe embeds
- Select defaults moeten overeenkomen met een bestaande option value en select options moeten merchant-zichtbare labels hebben
- Presets moeten aanwezig en render-safe blijven; edit-rewrites mogen bestaande presets niet stilzwijgend verwijderen
- In Impact-like theme context hoort de validator normale sections te blokkeren wanneer `section-spacing-collapsing`/`section-properties` of equivalente wrapperconventies ontbreken, lokale CSS niet onder `#shopify-section-{{ section.id }}` is gescoped, of een dubbele background-shell wordt gebouwd rond een helper die de outer surface al beheert
- Theme-scale guardrails mogen content sections blokkeren wanneer ze onbedoeld hero-groot worden
- Theme-scale guardrails kijken nu niet alleen naar losse maxima, maar ook naar gecombineerde visuele massa. Middelgrote overschrijdingen in font-size, padding, gap en sticky compositie kunnen samen dus alsnog een `inspection_failed_theme_scale` opleveren.
- Parser-onveilige JS/Liquid combinaties falen vóór preview upload
- Theme Editor lifecycle hooks zijn verplicht voor precision-first interactieve replica’s
- Screenshot-only exacte replica's zonder losse assets mogen niet blind op `placeholder_svg_tag` leunen; gebruik liever renderbare demo-media of een gestileerde media shell met correcte aspect-ratio en merchant-editable settings
- Exact-match comparison/shell replica's mogen niet terugvallen op een generieke tabel zonder de onderscheidende decoratieve media/badge anchors uit de referentie.
- Exact-match comparison/shell replica's mogen geen dubbele background-shell bouwen wanneer een theme wrapper-helper al een outer background of spacing-surface impliceert.
- Decoratieve inline SVG-iconen zoals sterratings, quote marks of badges tellen niet meer automatisch als merchant-media; een generieke `image_picker` warning hoort alleen nog terug te komen wanneer er echt image/video-markup of resource-based media aanwezig is.

### Bekende validatiegaten uit fase 1
- Exacte media-first heroes krijgen nu harde checks op:
  - media-first versus split-layout DOM-mismatch
  - gedeeld media-slot tussen uploaded en fallback-media
  - onterechte outer `page-width` / `.container` op de hero-shell
  - theme wrappers die de media-shell alsnog boxen terwijl alleen de inner contentlaag bounded mag zijn
- Voor Shopify resource-media wordt raw `<img>` met `image_url`/`img_url` nu hard afgekeurd, ook als width/height al aanwezig zijn. Pure hardcoded demo-URLs met expliciete dimensies blijven toegestaan als fallbackpad.
- Ontbrekende `block.shopify_attributes` is nu hard failure in relevante section-loops en native block-render snippets.
- Hosted video-markup met alleen schema type `video_url` is nu hard failure; externe embedflows met `video_url` blijven toegestaan.
- Prompt-only review/video/PDP/featured-product/featured-collection fidelity wordt nu hard afgedwongen op de eerste write voor de belangrijkste non-hero regressies: review cards/rating, video source/renderpad, productbron/commerce action, collection-bron en editor-bruikbare repeatable blocks.
- Wat nog open blijft:
  - de volledige `media layer -> overlay layer -> content layer` architectuur wordt nog niet op elk niet-exact hero/video-pad als generiek contract afgedwongen
  - wrapper-correctheid buiten de media-first/full-bleed hero-familie blijft deels theme-aware guidance in plaats van universele hard fail
  - native product-block renderer-contracten zijn sterker dan voorheen, maar nog niet gelijkwaardig hard voor elke theme-architectuur buiten de bestaande schema/snippet/block-wrapper checks

## Related Docs
- `docs/00-START-HERE.md`
- `docs/01-TECH-STACK.md`
- `docs/02-SYSTEM-FLOW.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- `docs/05-REMEDIATION-PLAN.md`
