# Theme Section Generation
Doelgroep: repo maintainers, developers en coding agents.

Deze gids beschrijft de actuele waarheid voor screenshot-driven en text-only section/block generation in `@hazify/mcp-remote`.

## Scope
- Nieuwe standalone sections uit screenshots of tekst
- Bestaande section edits
- Native product-page blocks in bestaande sections/snippets
- Expliciete JSON template placement
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

1. `get-themes`
2. `plan-theme-edit` met `intent="new_section"` op het expliciete target theme
3. Lees exact `nextReadKeys` met `includeContent=true`
4. `create-theme-section`
5. Alleen bij bredere visuele refinements: `draft-theme-artifact mode="edit"` met volledige rewrite

Verwachte plannertruth:
- `qualityTarget = "exact_match"`
- `generationMode = "precision_first"`
- `completionPolicy.deliveryExpectation = "final_reference_match_in_first_write"`
- Geen baseline-first vraag of extra toestemming voor pixel-perfect styling

Voorbeeldprompt:
```text
Maak deze Trustpilot review slider exact na van de screenshot als standalone section in theme 123.
```

### Text-only nieuwe section
Gebruik wanneer de gebruiker geen referentiebeeld geeft, maar wel een duidelijke beschrijving.

1. `get-themes`
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
- Broad rewrites op bestaande grote files blijven beschermd door truncation checks
- Gebruik `value` alleen als het volledige bestand bewust is ingelezen en vervangen moet worden

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
- `templates/*.json` hoeft na planning meestal niet opnieuw gelezen te worden tenzij placement expliciet gevraagd is

Voorbeeldprompt:
```text
Voeg een review badge native block toe aan de productpagina.
```

### Expliciete template placement
Nieuwe sections worden niet automatisch in templates geplaatst. Placement gebeurt alleen op expliciete gebruikersvraag.

1. Maak eerst de section
2. Daarna aparte `draft-theme-artifact mode="edit"` op `templates/*.json`

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
- `apply-theme-draft` is alleen voor promote/apply van een bestaande draft, nooit voor de eerste create-write

## Token-Efficiënte Flow
- Plan eerst, lees daarna alleen `nextReadKeys`
- Gebruik `search-theme-files` voor compacte anchors
- Gebruik `patch` / `patches` voor kleine bestaande-file edits
- Gebruik volledige rewrites alleen wanneer het doelbestand bewust volledig is ingelezen
- Houd theme requests op maximaal 10 bestanden

## Validation Truth
- Schema JSON moet geldig zijn
- Range settings moeten binnen min/max en step-grid vallen
- Theme-scale guardrails mogen content sections blokkeren wanneer ze onbedoeld hero-groot worden
- Parser-onveilige JS/Liquid combinaties falen vóór preview upload
- Theme Editor lifecycle hooks zijn verplicht voor precision-first interactieve replica’s

## Related Docs
- `docs/00-START-HERE.md`
- `docs/01-TECH-STACK.md`
- `docs/02-SYSTEM-FLOW.md`
- `docs/codex-mcp-section-generation-tracker.md`
