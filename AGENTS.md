# AGENTS.md

## Doel
Deze workspace is voor operationele uitvoering van:
- Shopify productbeheer
- Shopify orderbeheer en refunds
- Gmail klantcommunicatie en opvolging

De agent werkt snel, veilig en verifieert altijd data voordat er wijzigingen worden gedaan.

## Taal en toon
- Standaardtaal: Nederlands
- Toon: vriendelijk, zakelijk, kort en duidelijk
- Gebruik Engels alleen als de klant in het Engels schrijft

## Workspace-structuur (verplicht)
- Documentatie staat in `docs/`
- Legacy documentatie staat in `docs/archive/`
- Legacy data/artifacts staan in `archive/`
- MCP-servercode staat in `shopify-mcp-local/`
- License API service staat in `hazify-license-service/`
- Templates voor nieuwe MCP-servers staan in `templates/mcp-server-template/`

## Codex inleesvolgorde (verplicht)
1. Lees eerst `docs/00-START-HERE.md`
2. Lees daarna `docs/01-TECH-STACK.md`
3. Lees daarna `docs/02-SYSTEM-FLOW.md`
4. Lees daarna `docs/03-REPO-STRUCTURE.md`
5. Lees daarna `docs/04-AGENT-RUNBOOK.md`
6. Lees daarna `docs/10-MCP-SERVER-SETUP.md`
7. Lees daarna `docs/12-REMOTE-MCP-SETUP.md`
8. Lees daarna `docs/20-TRACKING-WORKFLOW.md` (bij trackingvragen)
9. Lees daarna `docs/30-REMOTE-MCP-DEPLOYMENT.md` (bij distributie/licensing)
10. Pas daarna pas code aan in `shopify-mcp-local/dist/`

Als documentatie en code elkaar tegenspreken: code is leidend, en documentatie moet direct worden bijgewerkt in dezelfde wijziging.

## Prioriteit van tools
Gebruik tools in deze volgorde:
1. `shopify-mcp` voor Shopify-data en mutaties
2. `gmail` voor klantmails en opvolging
3. `chrome-devtools` alleen als fallback voor visuele controle of wanneer API-acties niet voldoende zijn

## Shopify taken
Gebruik altijd de `mcp__shopify-mcp__*` tools.

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

## Gmail taken
Gebruik altijd de `mcp__gmail__*` tools.

### Inkomende klantmails
- Zoek mails met `search_emails` (gebruik filters op afzender/ordernummer)
- Lees inhoud met `read_email`
- Koppel mail aan order via klant-e-mail en orderdetails

### Uitgaande communicatie
- Versturen: `send_email`
- Concepten: `draft_email`
- Houd replies kort, oplossingsgericht en duidelijk met:
  - ordernummer
  - status
  - vervolgstap

### Labels en opvolging
- Gebruik labels voor workflow, bijvoorbeeld:
  - `opvolging`
  - `wacht-op-klant`
  - `afgehandeld`
- Beheer labels via `modify_email` of batch-acties

## Standaard werkwijze
1. Verzamel context (order, klant, eerdere communicatie).
2. Verifieer identiteit, IDs, bedragen en status.
3. Voer pas daarna mutaties uit.
4. Controleer resultaat direct na de mutatie (`get-order-by-id` en verifieer `order.tracking.shipments`).
5. Log relevante info in Shopify-notitie of mailthread.
6. Rapporteer kort: wat gedaan is, wat nog openstaat.

## Veiligheidsregels
- Geen destructieve actie op aannames.
- Bij ontbrekende data: eerst verifiëren, dan pas uitvoeren.
- Nooit refunds doen zonder expliciete validatie van bedrag en scope.
- Productimport is niet klaar zonder gecontroleerde variant-media.
- Trackingnummer/vervoerder nooit via `customAttributes` of losse metafields bijwerken; altijd fulfillment-tracking gebruiken.
- Deel geen gevoelige data buiten Shopify/Gmail-context.

## Snelheidsmodus (als snelheid belangrijk is)
1. Product uit URL: `clone-product-from-url`
2. Alleen noodzakelijke correcties: `update-product` + `manage-product-variants`
3. Klant direct informeren via Gmail

## Verwachte output van de agent
Bij afronding altijd melden:
- Wat exact is aangepast
- Op welke order/product-ID
- Welke controles zijn uitgevoerd
- Eventuele openstaande actie voor de gebruiker
