# AGENTS.md
Doelgroep: coding agents / Codex maintainers.

Dit bestand is interne maintainer-documentatie voor de Hazify monorepo.

Actuele infrastructuurwaarheid:
- `apps/hazify-license-service` is Postgres-only.
- `apps/hazify-mcp-remote` is HTTP-only en gebruikt PostgreSQL voor `theme_drafts` en advisory locks.

## Doel
Deze workspace bevat de productiecode voor:
- Shopify productbeheer
- Shopify orderbeheer en refunds
- Shopify theme file beheer via API
- Gevalideerde preview/apply workflows voor Shopify theme editing

## Taal en toon
- Standaardtaal: Nederlands
- Toon: vriendelijk, zakelijk, kort en duidelijk
- Gebruik Engels alleen als de klant in het Engels schrijft

## Workspace-structuur
- Documentatie staat in `docs/`
- MCP-servercode staat in `apps/hazify-mcp-remote/`
- License API service staat in `apps/hazify-license-service/`
- Gedeelde packages staan in `packages/`
- Root scripts staan in `scripts/`

## Codex inleesvolgorde
1. Lees eerst `docs/00-START-HERE.md`
2. Lees daarna `docs/01-TECH-STACK.md`
3. Lees daarna `docs/02-SYSTEM-FLOW.md`
4. Lees daarna `AGENTS.md`
5. Pas daarna pas code aan in `apps/hazify-mcp-remote/src/`

Als documentatie en code elkaar tegenspreken: code is leidend, en documentatie moet direct worden bijgewerkt in dezelfde wijziging.

## Prioriteit van tools
1. Gebruik de Hazify MCP toolregistry als bron van waarheid voor toolnamen en contracts.
2. Gebruik voor bestaande theme edits de vaste flow `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`.

## Shopify taken
Gebruik altijd de actieve MCP tools uit de gedeelde registry. Beschikbare tools voor API-interacties worden hieronder dynamisch bijgehouden.

<!-- BEGIN: TOOLS_LIST -->
- **`add-tracking-to-order`**: Alias of set-order-tracking. Kept for compatibility.
- **`apply-theme-draft`**: Apply a previously drafted theme artifact to an explicit target theme. This is the promote/apply step after draft-theme-artifact has prepared and verified the files.
- **`clone-product-from-url`**: Clone a public Shopify product URL into your connected store with options, variants, prices and media.
- **`create-product`**: Create a new product. When using productOptions, Shopify registers all option values but only creates one default variant (first value of each option, price $0). Use manage-product-variants with strategy=REMOVE_STANDALONE_VARIANT afterward to create all real variants with prices.
- **`delete-product`**: Delete a product
- **`delete-product-variants`**: Delete one or more variants from a product
- **`delete-theme-file`**: Delete a file from a Shopify theme (defaults to live theme role=main).
- **`draft-theme-artifact`**: Draft and validate Shopify theme files through the guarded preview pipeline. Use this to safely write or update theme files - fixes, modifications, and small additions. Files are inspected, linted, stored in theme_drafts, pushed to a preview-safe target by default, and verified after write.

Rules for valid Shopify Liquid:

Do not place Liquid inside {% stylesheet %} or {% javascript %}

Use <style> or markup-level CSS variables for section.id scoping

Every section must have a valid {% schema %} with presets
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
- **`verify-theme-files`**: Verify multiple theme files by expected metadata (size/checksumMd5).
<!-- END: TOOLS_LIST -->

## Theme edit workflow
### Bestaande theme edit
- Flow: `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`
- Gebruik deze flow voor bug fixes, CSS-wijzigingen, schema-aanpassingen en kleine gerichte uitbreidingen.
- Zoek altijd eerst op zichtbare tekst, schema-naam of specifieke selectors.
- Lees pas daarna het bestaande bestand in en draft alleen de noodzakelijke bestanden.

## Theme workflow
1. Gebruik voor create/update van theme code uitsluitend `draft-theme-artifact`.
2. `draft-theme-artifact` schrijft standaard preview-first naar `themeRole=development`.
3. Gebruik `apply-theme-draft` alleen wanneer een eerder draft expliciet naar een gekozen target gepromoot moet worden.
4. Gebruik `delete-theme-file` alleen na expliciete validatie van het target-bestand.
5. Verifieer writes direct via de `verify` output van `draft-theme-artifact` of aanvullend met `get-theme-file`, `get-theme-files` of `verify-theme-files`.
6. Om Railway te beschermen is er een harde limiet van maximaal 10 bestanden per theme-request.

## Shopify-conforme file policy
- Beperk writes tot de noodzakelijke theme-bestanden; voor section-wijzigingen is dat meestal `sections/<handle>.liquid`.
- Voeg alleen `snippets/` toe als markup of logica echt herhaald wordt.
- Voeg alleen `blocks/` files toe als je bewust theme blocks nodig hebt.
- Voeg alleen `locales/*.json` patches toe bij vaste, niet-merchant-editable UI strings.
- Maak geen `templates/*.json` of `config/*.json` writes in deze flow.
- Maak geen assets standaard; gebruik component-scoped CSS/JS in de section zelf.
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`.

## Product-import regels
1. Gebruik bij URL-import eerst `clone-product-from-url`.
2. Controleer daarna expliciet variant-media mapping.
3. Publiceer pas als variant-media correct is bevestigd.
4. Verifieer bij twijfel via Shopify Admin readback voordat je publiceert.

## Tracking workflow
1. Lees order met `get-order-by-id` en gebruik `order.tracking.shipments` als bron.
2. Vraag vervoerders op met `get-supported-tracking-companies` en kies exact uit de lijst.
3. Werk tracking bij met `set-order-tracking` of een compatibele alias.
4. Verifieer direct met `get-order-by-id` dat `order.tracking.shipments` is aangepast.
5. Gebruik nooit `customAttributes` of losse metafields als tracking source of truth.

## Refund regels
1. Verifieer order-ID, bedrag en scope voordat je refund uitvoert.
2. Leg bedrag, reden en scope altijd vast in ordernotitie of auditveld.

## Veiligheidsregels
- Geen destructieve actie op aannames.
- Bij ontbrekende data: eerst verifiëren, dan pas uitvoeren.
- Voor destructieve en financiële mutaties (zoals `delete-product`, `delete-theme-file`, `apply-theme-draft`, `refund-order` en `update-order`) dwingt de API verplichte `confirmation` strings en vaak een `reason` af.
- `layout/theme.liquid` blijft kritiek; `content_for_header` en `content_for_layout` mogen nooit verdwijnen.
- LLM's mogen secties niet automatisch live plaatsen of templates/config aanpassen om placement af te dwingen.
- Deel geen gevoelige data buiten Shopify-context.

## OpenAI Safety Check Workaround
- Bij reads: maak queries specifieker met strikte `filePatterns` of scope.
- Bij writes: controleer eerst of verplichte `confirmation` of `value` velden niet ontbreken.

## Verwachte output van de agent
Bij afronding altijd melden:
- Wat exact is aangepast
- Op welke order/product-ID of welk theme/draft
- Welke controles zijn uitgevoerd
- Eventuele openstaande actie voor de gebruiker
