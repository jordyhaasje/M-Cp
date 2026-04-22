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
- Product-page native blocks
- Bestaande section edits
- Nieuwe standalone sections
- Expliciete template placement
- Text-only / no-reference generatie

De planner representeert deze requests via `intent`, `qualityTarget`, `category` en `sectionBlueprint.archetype`. De validator- en write-pipeline blijft hetzelfde: betere promptclassificatie mag nooit safety checks verzwakken.

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
- Geen baseline-first vraag of extra toestemming voor pixel-perfect styling
- Screenshot-only referenties zonder losse bron-assets mogen `previewMediaPolicy = "best_effort_demo_media"` gebruiken. Dan blijft de layout/styling precisie-first, maar mag de eerste write renderbare demo-media of een gestileerde media shell bevatten in plaats van een hard fail op placeholder-only media.
- Als de prompt wel expliciete bron-assets noemt, hoort de planner streng te blijven met `previewMediaPolicy = "strict_renderable_media"` en `requiresRenderablePreviewMedia = true`
- Als de referentie expliciet desktop en mobiel toont, hoort de planner `requiresResponsiveViewportParity = true` te signaleren.
- Als de referentie duidelijke decoratieve anchors noemt of toont, zoals floating productmedia, badges of seals, horen die anchors onderdeel van de eerste write te blijven en niet te degraderen naar een generieke baseline.
- Als de referentie een echte rating-strip of comparison-iconografie toont, moeten sterren en check/x/thumb-iconen in de eerste write ook herkenbaar blijven in plaats van generieke blokjes, cirkels of lege vakken.
- Voor comparison/shell replica's hoort de pipeline dubbele background-shells te vermijden wanneer theme wrappers zoals `section-properties` al de outer surface of spacinglaag beheren.

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
- Broad rewrites op bestaande grote files blijven beschermd door truncation checks
- Gebruik `value` alleen als het volledige bestand bewust is ingelezen en vervangen moet worden
- Gebruik in `files[].value` altijd echte volledige bestandsinhoud; context-placeholders of samenvattingen zoals `REWRITE_ALREADY_APPLIED_IN_CONTEXT` zijn ongeldig

Voorbeeldprompt:
```text
Maak de bestaande reviews-showcase compacter en verander de kaart-gap op mobiel.
```

### Native product block
Gebruik wanneer de gebruiker een block in een bestaande productsection wil, bijvoorbeeld `main-product` of `product-info`.

1. `plan-theme-edit` met `intent="native_block"`
2. Lees alleen de door de planner voorgestelde section/snippet files
3. `draft-theme-artifact mode="edit"` of `patch-theme-file`

Belangrijk:
- Veel themes renderen product blocks via snippets
- Dit is meestal geen `blocks/*.liquid` create-flow
- Het planner-geselecteerde templatebestand hoeft na planning meestal niet opnieuw gelezen te worden tenzij placement expliciet gevraagd is

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
### Social strips
- Queries zoals `Instagram strip`, `TikTok feed`, `social strip` of `UGC feed` moeten media-georiënteerd plannen
- Zonder sliderwoorden hoort dit meestal bij archetype `social_strip`
- Met `slider` of `carousel` hoort dit bij `social_slider`

### Video sections
- Gebruik schema type `video` voor merchant-uploaded Shopify video
- Gebruik `video_url` alleen voor externe embeds
- Interactieve video carousels vereisen Theme Editor lifecycle hooks en veilig pausestop-gedrag voor inactieve slides

### Sliders en carousels
- Scope JS altijd per section instance
- Ondersteun Theme Editor events (`shopify:section:load`, `shopify:section:select`, `shopify:block:select`, `shopify:block:deselect`)
- Gebruik blank-safe media/link rendering

### Safe link/media guards
- Guard optionele `href`, `src`, `poster`, `action` en `formaction`
- Guard optionele `image_picker`, `video` en `video_url` settings vóór `image_url`, `video_tag` of `external_video_*`
- `block.shopify_attributes` hoort op block wrappers in loops over `section.blocks`

## Live Versus Preview
- `draft-theme-artifact` kan `status="preview_ready"` teruggeven terwijl het doeltheme het live `main` theme is
- Dit is geen impliciete publish-flow; het betekent dat de preview write naar het expliciet gekozen target succesvol was
- De remote moet live-target risico expliciet blijven waarschuwen

## Stateless Client Notes
- Gewone chatclients zoals ChatGPT, Claude en Perplexity missen soms server-side sessiecontext tussen toolcalls
- Daarom retourneren create-conflicts nu expliciet een repair-sequence: `plan-theme-edit intent="existing_edit"` -> exacte read(s) -> `draft-theme-artifact mode="edit"`
- Full rewrites op bestaande bestanden moeten altijd het volledige nieuwe bestand meesturen; de MCP kan een placeholder-string nooit terugvertalen naar echte Liquid

## Read Semantics
- `get-theme-files` of `read-theme-files` zetten `includeContent` niet blind automatisch aan.
- Die auto-hydratie gebeurt alleen wanneer de gevraagde `keys` exact overeenkomen met de planner `nextReadKeys` op een compatibel theme-target.
- Voor alle andere batch-reads blijft `includeContent` standaard `false` tenzij de client het expliciet meegeeft.
- `apply-theme-draft` is alleen voor promote/apply van een bestaande draft, nooit voor de eerste create-write

## Token-Efficiënte Flow
- Plan eerst, lees daarna alleen `nextReadKeys`
- Gebruik `search-theme-files` voor compacte anchors
- Gebruik `patch` / `patches` voor kleine bestaande-file edits
- Gebruik volledige rewrites alleen wanneer het doelbestand bewust volledig is ingelezen
- Houd theme requests op maximaal 10 bestanden

## Validation Truth
- Schema JSON moet geldig zijn
- Verplichte schema-velden zoals setting/block `label`, `type`, `id`, `name` en `content` waar relevant moeten al in lokale inspectie slagen, niet pas in `theme-check`
- Range settings moeten binnen min/max en step-grid vallen
- Theme-scale guardrails mogen content sections blokkeren wanneer ze onbedoeld hero-groot worden
- Parser-onveilige JS/Liquid combinaties falen vóór preview upload
- Theme Editor lifecycle hooks zijn verplicht voor precision-first interactieve replica’s
- Screenshot-only exacte replica's zonder losse assets mogen niet blind op `placeholder_svg_tag` leunen; gebruik liever renderbare demo-media of een gestileerde media shell met correcte aspect-ratio en merchant-editable settings
- Exact-match comparison/shell replica's mogen niet terugvallen op een generieke tabel zonder de onderscheidende decoratieve media/badge anchors uit de referentie.
- Exact-match comparison/shell replica's mogen geen dubbele background-shell bouwen wanneer een theme wrapper-helper al een outer background of spacing-surface impliceert.

## Related Docs
- `docs/00-START-HERE.md`
- `docs/01-TECH-STACK.md`
- `docs/02-SYSTEM-FLOW.md`
- `docs/04-MCP-REMOTE-AUDIT.md`
- `docs/05-REMEDIATION-PLAN.md`
- `docs/archive/codex-mcp-section-generation-tracker.md`
