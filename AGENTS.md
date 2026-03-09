# AGENTS.md

## Doel
Deze workspace is voor operationele uitvoering van:
- Shopify productbeheer
- Shopify orderbeheer en refunds

De agent werkt snel, veilig en verifieert altijd data voordat er wijzigingen worden gedaan.

## Taal en toon
- Standaardtaal: Nederlands
- Toon: vriendelijk, zakelijk, kort en duidelijk
- Gebruik Engels alleen als de klant in het Engels schrijft

## Workspace-structuur (verplicht)
- Documentatie staat in `docs/`
- Legacy documentatie staat in `docs/archive/`
- Legacy data/artifacts staan in `docs/archive/artifacts/`
- MCP-servercode staat in `apps/hazify-mcp-remote/`
- License API service staat in `apps/hazify-license-service/`
- Gedeelde packages staan in `packages/`
- Root scripts staan in `scripts/`

## Codex inleesvolgorde (verplicht)
1. Lees eerst `docs/00-START-HERE.md`
2. Lees daarna `docs/01-TECH-STACK.md`
3. Lees daarna `docs/02-SYSTEM-FLOW.md`
4. Lees daarna `docs/03-REPO-STRUCTURE.md`
5. Lees daarna `docs/04-AGENT-RUNBOOK.md`
6. Lees daarna `docs/10-MCP-SERVER-SETUP.md`
7. Lees daarna `docs/12-REMOTE-MCP-SETUP.md`
8. Lees daarna `docs/16-SECTION-REPLICA-RUNBOOK.md` (bij sectionvragen)
9. Lees daarna `docs/20-TRACKING-WORKFLOW.md` (bij trackingvragen)
10. Lees daarna `docs/30-REMOTE-MCP-DEPLOYMENT.md` (bij distributie/licensing)
11. Pas daarna pas code aan in `apps/hazify-mcp-remote/src/`

Als documentatie en code elkaar tegenspreken: code is leidend, en documentatie moet direct worden bijgewerkt in dezelfde wijziging.

## Prioriteit van tools
Gebruik tools in deze volgorde:
1. `shopify-mcp` voor Shopify-data en mutaties
2. `chrome-devtools` alleen als fallback voor visuele controle of wanneer API-acties niet voldoende zijn

## Shopify taken
Gebruik altijd de `mcp__shopify-mcp__*` tools.

### Themes en sections
- Themes ophalen: `get-themes`
- Theme bestand lezen: `get-theme-file`
- Theme bestand schrijven/updaten: `upsert-theme-file`
- Theme bestand verwijderen: `delete-theme-file`
- Section prepare (verplicht): `prepare-section-replica`
- Section apply (verplicht): `apply-section-replica`
- Legacy wrappers (tijdelijk): `build-theme-section-bundle`, `import-section-to-live-theme`

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
4. Bij twijfel of ontbrekende API-zichtbaarheid: visuele check via `chrome-devtools`.

### Theme/section workflow (verplicht)
1. Haal themes op met `get-themes` en bevestig live theme (`role=main`) of gebruik expliciet `themeId`.
2. Voor sections: gebruik altijd `prepare-section-replica` met `referenceUrl` + `sectionSpec` (+ optionele `imageUrls`).
3. Controleer `validation.preflight` en voer alleen daarna `apply-section-replica` uit.
4. Gebruik legacy wrappers alleen voor backward compatibility; plan migratie naar `prepare/apply`.
5. Verifieer met `get-theme-file` dat `sections/<handle>.liquid`, template JSON (`sections` + `order`) en assets/snippets kloppen.
6. Alleen bij visuele twijfel of rendering issues: check via `chrome-devtools`.

### Orders
- Ophalen: `get-orders`, `get-order-by-id`
- Klantorders: `get-customer-orders`
- Updaten: `update-order` (tags/notities/adres/trackingvelden)
- Tracking (one-shot): `set-order-tracking` (voorkeur voor LLMs)
- Tracking (voorkeur): `update-fulfillment-tracking` (altijd voor trackingnummer/vervoerder)

### Tracking workflow (verplicht)
1. Lees order met `get-order-by-id` en gebruik `order.tracking.shipments` als bron.
2. Vraag vervoerders op met `get-supported-tracking-companies` en kies exact uit de lijst.
3. Werk tracking bij met `set-order-tracking` (of alias `update-order-tracking` / `add-tracking-to-order`; fallback: `update-fulfillment-tracking` / `update-order.tracking`).
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
- Nooit refunds doen zonder expliciete validatie van bedrag en scope.
- Productimport is niet klaar zonder gecontroleerde variant-media.
- Trackingnummer/vervoerder nooit via `customAttributes` of losse metafields bijwerken; altijd fulfillment-tracking gebruiken.
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
