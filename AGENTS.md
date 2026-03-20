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

## Prioriteit van tools
Gebruik tools in deze volgorde:
1. `shopify-mcp` voor Shopify-data en mutaties

## Shopify taken
Gebruik altijd de `mcp__shopify-mcp__*` tools.

### Themes
- Themes ophalen: `get-themes`
- Nieuwe OS 2.0 section maken en plaatsen: `create-theme-section`
- Theme bestand lezen: `get-theme-file`
- Theme bestanden batch lezen: `get-theme-files`
- Theme bestand schrijven/updaten: `upsert-theme-file`
- Theme bestanden batch schrijven/updaten: `upsert-theme-files`
- Theme bestand verwijderen: `delete-theme-file`
- Theme bestanden verifiëren: `verify-theme-files`
- Externe import tooling metadata ophalen: `list_theme_import_tools`

### Producten
- Ophalen: `get-products`, `get-product-by-id`
- Aanmaken: `create-product`
- Bijwerken: `update-product`
- Variants: `manage-product-variants`, `delete-product-variants`
- Opties: `manage-product-options`
- Verwijderen: `delete-product`
- Import via URL: `clone-product-from-url`

### Product-import regels (verplicht)
1. Gebruik bij URL-import eerst `clone-product-from-url`.
2. Controleer daarna expliciet variant-media mapping (kleur/stijl moet juiste image hebben).
3. Publiceer pas als variant-media correct is bevestigd.
4. Bij twijfel of ontbrekende API-zichtbaarheid: verifieer via Shopify Admin readback voordat je publiceert.

### Theme workflow (verplicht)
1. Haal themes op met `get-themes` en bevestig live theme (`role=main`) of gebruik expliciet `themeId`.
2. Gebruik `upsert-theme-file`/`delete-theme-file` alleen na expliciete validatie van target-bestand.
3. Verifieer writes altijd met `get-theme-file`.
4. Voor nieuwe OS 2.0 sections op ondersteunde JSON targets: gebruik `create-theme-section`.
5. Gebruik `list_theme_import_tools` alleen voor expliciete externe review/import discovery buiten de native remote MCP flow.

### Orders
- Ophalen: `get-orders`, `get-order-by-id`
- Klantorders: `get-customer-orders`
- Updaten: `update-order` (tags/notities/adres/trackingvelden)
- Tracking (one-shot): `set-order-tracking` (voorkeur voor LLMs)
- Tracking (voorkeur): `update-fulfillment-tracking` (altijd voor trackingnummer/vervoerder)

### Klanten
- Ophalen: `get-customers`
- Bijwerken: `update-customer`

### Licentie
- Status opvragen: `get-license-status`

### Tracking workflow (verplicht)
1. Lees order met `get-order-by-id` en gebruik `order.tracking.shipments` als bron.
2. Vraag vervoerders op met `get-supported-tracking-companies` en kies exact uit de lijst.
3. Werk tracking bij met `set-order-tracking` (of alias `update-order-tracking` / `add-tracking-to-order`; fallback: `update-fulfillment-tracking`).
4. Verifieer direct met `get-order-by-id` dat `order.tracking.shipments` is aangepast.
5. Als `legacyCustomAttributes` of `legacyMetafields` zichtbaar zijn: niet gebruiken als bron, alleen fulfillment-tracking aanhouden.

### Refunds
- Gebruik: `refund-order`
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

## Veiligheidsregels
- Geen destructieve actie op aannames.
- Bij ontbrekende data: eerst verifiëren, dan pas uitvoeren.
- Voor destructieve en financiële mutaties (zoals `delete-product`, `delete-theme-file`, `upsert` overwrites, `refund-order` en `update-order`) dwingt de API een verplichte `confirmation` string (en vaak een `reason`) af. Lees het Zod-schema zorgvuldig en genereer deze fields nooit zonder doordachte "Chain of Thought" over de noodzaak.
- Het wijzigen van `layout/theme.liquid` is kritiek. Zorg altijd dat `content_for_header` en `content_for_layout` behouden blijven. Verwijderen is intern geblokkeerd ter bescherming.
- LLM's mogen NOOIT proberen secties "live" te zetten of de layout te wijzigen door JSON templates (zoals `templates/index.json` of bestanden in `config/`) aan te passen. Dit is strikt verboden wegens kans op homepage destructie. Een taak voor het maken van een section is direct voltooid zodra de losse bronbestanden (.liquid, .css, .js) succesvol via de API zijn aangemaakt in hun map. Instrueer de klant om de gemaakte sectie toe te voegen via de Shopify Theme Editor.
- Nooit refunds doen zonder expliciete validatie van bedrag en scope.
- Productimport is niet klaar zonder gecontroleerde variant-media.
- Trackingnummer/vervoerder nooit via `customAttributes` of losse metafields bijwerken; altijd fulfillment-tracking gebruiken.
- Geen section-create uitvoeren zonder expliciete target-validatie; unsupported importflows blijven extern.
- Deel geen gevoelige data buiten Shopify-context.

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
