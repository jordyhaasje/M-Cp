# Agent.md (Client instructies voor Hazify MCP)

Doel: geef externe AI-clients (ChatGPT, Claude, Perplexity, Cursor, VS Code) een eenduidige werkwijze voor onze remote Shopify MCP.

## Kernprincipe
- Gebruik multi-MCP orchestration in de client:
  - Chrome MCP: inspectiecontext (DOM/CSS/scripts)
  - Hazify Shopify MCP: veilige data-mutaties in Shopify
- De remote Shopify MCP roept de lokale Chrome MCP niet direct aan.

## Tool-catalogus (Hazify MCP)
- Producten: `get-products`, `get-product-by-id`, `create-product`, `update-product`, `manage-product-variants`, `manage-product-options`, `delete-product`, `delete-product-variants`, `clone-product-from-url`
- Orders/klanten: `get-orders`, `get-order-by-id`, `get-customer-orders`, `get-customers`, `update-order`, `update-customer`
- Tracking/refund: `get-supported-tracking-companies`, `set-order-tracking`, `update-fulfillment-tracking`, `update-order-tracking`, `add-tracking-to-order`, `refund-order`
- Theme/sections: `read-theme-files`, `validate-theme-section`, `upsert-theme-section`, `upsert-theme-section-pack`, `inject-section-into-template`
- Status: `get-license-status`

## Intent routing (kritiek)
- Vraag bevat `section`, `theme`, `liquid`, `template`, `inspecteer URL`, `maak na`, `importeer in theme`:
  - Gebruik section flow tools.
  - Gebruik **nooit** `clone-product-from-url`.
- Vraag bevat productimport van publieke productpagina:
  - Gebruik `clone-product-from-url`.

## Verplichte workflow voor section build/import
1. Inspecteer referentiepagina met Chrome MCP.
2. Genereer Shopify section liquid met `{% schema %}`.
3. Call `validate-theme-section`.
4. Call `upsert-theme-section-pack` (section.liquid + styles.css + optionele snippets/assets).
5. Call `inject-section-into-template` alleen als `targetTemplate` niet al in pack-call is meegegeven.
6. Call `read-theme-files` om te verifiëren.

Section pack conventie:
- Vereist output:
  - `sections/<id>.liquid`
  - `assets/sections-library/<id>/styles.css`
- Optioneel:
  - `snippets/<id>--*.liquid`
  - `assets/sections-library/<id>/*.(css|js|json|txt|svg)`
- ID format: `[a-z0-9-]`
- Bij conflict met bestaande merchant files: alleen overschrijven met expliciete consentvelden.

## Veiligheidsregels
- Schrijf alleen naar `sections/*.liquid` en `templates/*.json`.
- Live theme writes (`theme.role=MAIN`) vereisen altijd:
  - `liveWrite=true`
  - `confirm_live_write=true`
  - `confirmation_reason`
  - `change_summary`
- Zonder deze velden moeten writes falen.
- `clone-product-from-url` is uitsluitend voor productdata, niet voor section-import.
- Gebruik voor tracking uitsluitend fulfillment-tracking tools, nooit customAttributes/metafields als tracking-bron.
- Gebruik Chrome MCP alleen voor visuele analyse; clone geen derde partij code 1-op-1.

## MCP-native guidance
- Resource: `hazify://catalog/tools`
- Resource: `hazify://playbooks/theme-safety`
- Prompt: `hazify-theme-section-playbook`

## OAuth + transport defaults
- Transport: Streamable HTTP op `/mcp`
- OAuth scope: `mcp:tools`
- PKCE: verplicht, alleen `S256`
- Auth op `/mcp`: alleen `Authorization: Bearer` of `x-api-key`
