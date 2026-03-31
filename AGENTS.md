# AGENTS.md
Doelgroep: coding agents / Codex.

## Doel
Deze workspace is voor operationele uitvoering van:
- Shopify productbeheer
- Shopify orderbeheer en refunds
- Shopify theme file beheer via API

De agent werkt snel, veilig en verifieert altijd data voordat er wijzigingen worden gedaan.

## Taal en toon
- Standaardtaal: Nederlands
- Toon: vriendelijk, zakelijk, kort en duidelijk
- Gebruik Engels alleen als de klant in het Engels schrijft

## Workspace-structuur (verplicht)
- Documentatie staat in `docs/`
- MCP-servercode staat in `apps/hazify-mcp-remote/`
- License API service staat in `apps/hazify-license-service/`
- Gedeelde packages staan in `packages/`
- Root scripts staan in `scripts/`

## Codex inleesvolgorde (verplicht)
1. Lees eerst `docs/00-START-HERE.md`
2. Lees daarna `docs/01-TECH-STACK.md`
3. Lees daarna `docs/02-SYSTEM-FLOW.md`
4. Lees daarna `AGENTS.md` (deze instructie)
5. Pas daarna pas code aan in `apps/hazify-mcp-remote/src/`

Als documentatie en code elkaar tegenspreken: code is leidend, en documentatie moet direct worden bijgewerkt in dezelfde wijziging.

# Prioriteit van tools
Gebruik tools in deze volgorde:
1. `shopify-mcp` voor Shopify-data en mutaties

## Shopify taken
Gebruik altijd de `mcp__shopify-mcp__*` tools. Beschikbare tools voor API-interacties worden in de onderstaande lijst dynamisch bijgehouden.

<!-- BEGIN: TOOLS_LIST -->
- **`add-tracking-to-order`**: Alias of set-order-tracking. Kept for compatibility.
- **`analyze-reference-ui`**: Fetches en analyseert een externe URL als visuele referentie, stript agressief onnodige tags (<script>, svg, data-uri), en formatteert de HTML naar een extreem token-efficiënte, Pug-achtige Markdown representatie met strikt behoud van Classes en IDs voor UI / CSS component modeling.
- **`clone-product-from-url`**: Clone a public Shopify product URL into your connected store with options, variants, prices and media.
- **`create-product`**: Create a new product. When using productOptions, Shopify registers all option values but only creates one default variant (first value of each option, price $0). Use manage-product-variants with strategy=REMOVE_STANDALONE_VARIANT afterward to create all real variants with prices.
- **`create-theme-section`**: Create a new OS 2.0 section file and place it directly into a supported JSON template or section group without first searching for an existing section.
- **`delete-product`**: Delete a product
- **`delete-product-variants`**: Delete one or more variants from a product
- **`delete-theme-file`**: Delete a file from a Shopify theme (defaults to live theme role=main).
- **`get-customer-orders`**: Get orders for a specific customer
- **`get-customers`**: Get customers or search by name/email
- **`get-license-status`**: Return current license status, effective access, and MCP scope capabilities.
- **`get-order-by-id`**: READ-ONLY: fetch a specific order and tracking status. Does not update anything.
- **`get-orders`**: READ-ONLY: get orders with optional filtering by status. Supports cursor pagination.
- **`get-product-by-id`**: Get a specific product by ID
- **`get-products`**: Get all products or search by title
- **`get-supported-tracking-companies`**: Get Shopify-supported tracking carriers that can be selected in the order fulfillment tracking UI
- **`get-theme-file`**: Read a file from a Shopify theme (defaults to live theme role=main).
- **`get-theme-files`**: Read multiple files from a Shopify theme with metadata-first default output.
- **`get-themes`**: List available Shopify themes (including the live theme).
- **`list_theme_import_tools`**: List metadata/advice for external tools used outside this remote MCP for visual review or external import workflows. Do not use this for normal native section creation inside the remote MCP.
- **`manage-product-options`**: Create, update, or delete product options (e.g. Size, Color). Use action='create' to add options, 'update' to rename or add/remove values, 'delete' to remove options.
- **`manage-product-variants`**: Create or update product variants. Omit variant id to create new, include id to update existing.
- **`refund-order`**: Create a full or partial refund for an order using Shopify refundCreate.
- **`search-theme-files`**: Search scoped theme files and return compact snippets instead of full file dumps. Prefer this before full reads when fixing styling/code or borrowing a small reference pattern.
- **`set-order-tracking`**: One-shot tracking update tool for LLMs: resolves order reference, updates fulfillment tracking, and returns verification-ready output.
- **`update-customer`**: Update a customer's information
- **`update-fulfillment-tracking`**: Update order shipment tracking in the actual fulfillment record (not custom attributes/metafields). fulfillmentId is optional; when omitted, the latest non-cancelled fulfillment is updated automatically.
- **`update-order`**: Update an existing order with new information
- **`update-order-tracking`**: Alias of set-order-tracking. Kept for compatibility.
- **`update-product`**: Update an existing product's fields (title, description, status, tags, etc.)
- **`upsert-theme-file`**: Create or update a single Shopify theme file, including new section/snippet/template/assets files when you already know the exact target key.
- **`upsert-theme-files`**: Create or update multiple Shopify theme files in chunked batches, including new section/snippet/template/assets files when exact targets are already known.
- **`verify-theme-files`**: Verify multiple theme files by expected metadata (size/checksumMd5).
<!-- END: TOOLS_LIST -->


### Product-import regels (verplicht)
1. Gebruik bij URL-import eerst `clone-product-from-url`.
2. Controleer daarna expliciet variant-media mapping (kleur/stijl moet juiste image hebben).
3. Publiceer pas als variant-media correct is bevestigd.
4. Bij twijfel of ontbrekende API-zichtbaarheid: verifieer via Shopify Admin readback voordat je publiceert.

### Theme workflow (verplicht)
1. Haal themes op met `get-themes` en bevestig live theme (`role=main`) of gebruik expliciet `themeId`.
2. Gebruik `upsert-theme-file`/`delete-theme-file` alleen na expliciete validatie van target-bestand.
   * **CRITICAL**: LLM's hebben de neiging om een `content` parameter te hallucineren. Dit is ten strengste verboden. Gebruik ALTIJD de verplichte `value` parameter voor het doorgeven van letterlijke bestandsinhoud (broncode/tekst) of `sectionLiquid` waar van toepassing.
3. Verifieer writes altijd met `get-theme-file`.
4. Voor nieuwe OS 2.0 sections op ondersteunde JSON targets: gebruik `create-theme-section`.
5. Gebruik `list_theme_import_tools` alleen voor expliciete externe review/import discovery buiten de native remote MCP flow.
6. **Limits & Concurrency**: Om de Railway server te beschermen is er een harde limiet van **maximaal 10 bestanden** per verzoek bij het ophalen, updaten of doorzoeken van thema's. Schrijfacties worden bovendien beveiligd met een **File Lock** (mutex). Krijg je een melding dat een bestand "locked by another operation" is, wacht dan even en probeer het rustig opnieuw.


### Tracking workflow (verplicht)
1. Lees order met `get-order-by-id` en gebruik `order.tracking.shipments` als bron.
2. Vraag vervoerders op met `get-supported-tracking-companies` en kies exact uit de lijst.
3. Werk tracking bij met `set-order-tracking` (of alias `update-order-tracking` / `add-tracking-to-order`; fallback: `update-fulfillment-tracking`).
4. Verifieer direct met `get-order-by-id` dat `order.tracking.shipments` is aangepast.
5. Als `legacyCustomAttributes` of `legacyMetafields` zichtbaar zijn: niet gebruiken als bron, alleen fulfillment-tracking aanhouden.

### Refund regels (verplicht)
- Verplicht vóór refund:
  1. Juiste order-ID
  2. Juiste regel(s) of bedrag
  3. Volledig of gedeeltelijk refunden
- Leg altijd vast in ordernotitie:
  - bedrag
  - reden
  - scope (volledig/gedeeltelijk)

## Standaard werkwijze
1. Verzamel context (order, klant, eerdere communicatie).
2. Verifieer identiteit, IDs, bedragen en status.
3. Voer pas daarna mutaties uit.
4. Controleer resultaat direct na de mutatie (`get-order-by-id` en verifieer `order.tracking.shipments`).
5. Log relevante info in Shopify-notitie of auditveld.
6. Rapporteer kort: wat gedaan is, wat nog openstaat.

### Theme Development Best Practices

#### De Verplichte Diagnose Workflow (Hoe je omgaat met gebruikers-prompts)
Gebruikers spreken in visuele termen (UI-labels, tekst op het scherm, paginanamen) en kennen geen bestandsnamen. Je mag NOOIT direct code schrijven op basis van een visuele beschrijving. Volg ALTIJD dit 4-stappenplan op de achtergrond:

**STAP 1: Mapping (Zoeken & Identificeren)**
Als een gebruiker zegt: "Pas de sectie 'Feature blocks' aan op de homepage" of "Verander de tekst 'Snelle levering' in de footer":
- Gok nooit de bestandsnaam.
- Gebruik direct `search-theme-files`. Zoek naar de exacte tekst die de gebruiker noemt, of zoek naar de sectienaam (omdat sectienamen in de Shopify Editor worden bepaald door het `{% schema %}` onderin het `.liquid` bestand).

**STAP 2: Analyseren (Lezen)**
Zodra je het juiste bestand hebt gevonden (bijv. `trust-badges.liquid` of `footer.liquid`), gebruik je `get-theme-file` om het in te lezen. Analyseer hoe de Liquid, HTML en CSS momenteel samenwerken.

**STAP 3: De Shopify Standaard Toepassen (Niet zelf verzinnen)**
Bedenk geen eigen, complexe CSS of JavaScript als de gebruiker om standaard web-elementen vraagt (zoals een mobiele slider). Gebruik de native Shopify (Dawn) architectuur:
- Vraagt de klant om een mobiele slider waarbij 1 item tegelijk in beeld is? Verwijder dan de `grid--peek` class en gebruik in je CSS patch: `width: 100% !important; flex: 0 0 100% !important; scroll-snap-align: center;` binnen een mobiele `@media` query.
- Vraagt de klant om een slider met dots? Gebruik de standaard Shopify `<slider-component>` structuur.

**STAP 4: Chirurgisch Patchen**
Gebruik `upsert-theme-file` in Patch Mode (`searchString` en `replaceString`). Overschrijf nooit het hele bestand. Zorg dat je wijzigingen voor mobiel altijd strikt scheidt van desktop via `@media screen and (max-width: 749px)`. Bevestig met de verplichte string `"UPSERT_THEME_FILE"`.

*Uitzondering:* Als de vraag van de gebruiker écht te vaag is (bijv. "Maak het mooier" of "Fix de knop" zonder verdere context), gebruik dan geen tools, maar vraag de gebruiker eerst om opheldering: "Op welke pagina staat deze knop en welke tekst staat erop, zodat ik het juiste bestand kan zoeken?"

> **Let op:** Als je conflicten verwacht bij de uitvoering van deze stappen, meld dit dan direct in je output aan de gebruiker.

#### Algemene Regels
1. **Stop Guessing:** Gok NOOIT blind naar bestandsnamen (zoals 'base.css' of 'product.json'). Elk Shopify-thema is uniek. Gebruik altijd `search-theme-files` om de actuele bestandsstructuur te scannen.
2. **Asset Registration:** Als je een nieuw asset (.css/.js) aanmaakt voor globale styling, onthoud dan dat Shopify dit NIET automatisch inlaadt. Je moet dit bestand expliciet koppelen in de layout (bijv. in `layout/theme.liquid` via `{{ 'filename.css' | asset_url | stylesheet_tag }}`).
3. **Global Mutation Rule (Scope Protection):** Overschrijf NOOIT een bestaande, globale sectie (zoals `sections/image-with-text.liquid`) als de klant vraagt om een specifieke aanpassing op één pagina. In Shopify 2.0 breekt dit de styling op alle andere pagina's. 
   - FOUT: Bestaande sectie direct overschrijven met `upsert-theme-file` of hardcoden met `{% if section.id == ... %}`.
   - GOED (BEST PRACTICE): Gebruik ALTIJD de `create-theme-section` tool om een nieuwe, veilige custom variant te maken (bijv. `sections/image-with-text-custom.liquid`) óf voeg een checkbox/schema-instelling toe aan de bestaande sectie zonder de default layout te breken.
4. **Save Tokens (Find & Replace):** Gebruik bij kleine aanpassingen in grote, bestaande bestanden (zoals base.css) NOOIT de `value` parameter om het hele bestand te herschrijven. Gebruik in plaats daarvan de parameters `searchString` en `replaceString` om alleen het specifieke blokje code te patchen.
5. **De Geverifieerde Workflow (Lezen = Weten):** Gok NOOIT of een thema bepaalde instellingen heeft. Bij vragen over simpele visuele wijzigingen (zoals het aanpassen van kleuren of lettertypes), patch je niet direct de CSS. Lees eerst `config/settings_data.json` of het specifieke sectie-bestand uit. Controleer of dit een instelling is (zoals een `color_scheme` in het schema) die de klant gewoon in de Shopify Theme Editor kan aanpassen. Als dat zo is, voer dan **GEEN code-wijziging** uit, maar vertel de klant waar ze dit in hun dashboard kunnen vinden. Dit bespaart token-kosten en voorkomt het onnodig patchen van bestanden.

## Veiligheidsregels
- Geen destructieve actie op aannames.
- Bij ontbrekende data: eerst verifiëren, dan pas uitvoeren.
- Voor destructieve en financiële mutaties (zoals `delete-product`, `delete-theme-file`, `upsert` overwrites, `refund-order` en `update-order`) dwingt de API een verplichte `confirmation` string (en vaak een `reason`) af. Lees het Zod-schema zorgvuldig en genereer deze fields nooit zonder doordachte "Chain of Thought" over de noodzaak. De exacte vereiste literals per theme-schrijf-tool zijn:
  | Tool | Vereiste `confirmation` literal |
  |---|---|
  | `create-theme-section` | `"CREATE_THEME_SECTION"` |
  | `upsert-theme-file` | `"UPSERT_THEME_FILE"` |
  | `upsert-theme-files` | `"UPSERT_THEME_FILES"` |
  | `delete-theme-file` | `"DELETE_THEME_FILE"` |
- Het wijzigen van `layout/theme.liquid` is kritiek. Zorg altijd dat `content_for_header` en `content_for_layout` behouden blijven. Verwijderen is intern geblokkeerd ter bescherming.
- LLM's mogen NOOIT proberen secties "live" te zetten of de layout te wijzigen door JSON templates (zoals `templates/index.json` of bestanden in `config/`) aan te passen. Dit is strikt verboden wegens kans op homepage destructie. Een taak voor het maken van een section is direct voltooid zodra de losse bronbestanden (.liquid, .css, .js) succesvol via de API zijn aangemaakt in hun map. Instrueer de klant om de gemaakte sectie toe te voegen via de Shopify Theme Editor.
- Nooit refunds doen zonder expliciete validatie van bedrag en scope.
- Productimport is niet klaar zonder gecontroleerde variant-media.
- Trackingnummer/vervoerder nooit via `customAttributes` of losse metafields bijwerken; altijd fulfillment-tracking gebruiken.
- Geen section-create uitvoeren zonder expliciete target-validatie; unsupported importflows blijven extern.
- Deel geen gevoelige data buiten Shopify-context.

### OpenAI Safety Check Workaround
Als je een foutmelding krijgt over "This tool call was blocked by OpenAI's safety checks" (bijvoorbeeld bij `search-theme-files` of `get-theme-file`), komt dit vaak doordat de payload te groot of onleesbaar is (zoals enorme geminificeerde bestanden), of doordat je zoekopdracht te breed was. 
**Oplossing:** Maak je actie specifieker. Gebruik bij zoekopdrachten altijd strikte `filePatterns` of `scope`. Probeer niet de hele codebase in één keer te lezen.

*(Let op bij schrijf-acties: Krijg je deze fout tijdens een upsert, dan heb je de Zod-validatie gefaald door bijv. `confirmation` te missen of `content` i.p.v. `value` te gebruiken.)*

## Snelheidsmodus (als snelheid belangrijk is)
1. Product uit URL: `clone-product-from-url`
2. Alleen noodzakelijke correcties: `update-product` + `manage-product-variants`
3. Verifieer en rapporteer direct in de task-output

## Verwachte output van de agent
Bij afronding altijd melden:
- Wat exact is aangepast
- Op welke order/product-ID
- Welke controles zijn uitgevoerd
- Eventuele openstaande actie voor de gebruiker
