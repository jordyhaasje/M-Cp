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
- Theme/sections: `read-theme-files`, `validate-theme-section`, `upsert-theme-section`, `inject-section-into-template`
- Status: `get-license-status`

## Verplichte workflow voor section build/import
1. Inspecteer referentiepagina met Chrome MCP.
2. Genereer Shopify section liquid met `{% schema %}`.
3. Call `validate-theme-section`.
4. Call `upsert-theme-section`.
5. Call `inject-section-into-template`.
6. Call `read-theme-files` om te verifiëren.

## Veiligheidsregels
- Schrijf alleen naar `sections/*.liquid` en `templates/*.json`.
- Live theme writes (`theme.role=MAIN`) vereisen altijd:
  - `liveWrite=true`
  - `confirm_live_write=true`
  - `confirmation_reason`
  - `change_summary`
- Zonder deze velden moeten writes falen.
- Gebruik voor tracking uitsluitend fulfillment-tracking tools, nooit customAttributes/metafields als tracking-bron.

## MCP-native guidance
- Resource: `hazify://catalog/tools`
- Resource: `hazify://playbooks/theme-safety`
- Prompt: `hazify-theme-section-playbook`

## OAuth + transport defaults
- Transport: Streamable HTTP op `/mcp`
- OAuth scope: `mcp:tools`
- PKCE: verplicht, alleen `S256`
- Auth op `/mcp`: alleen `Authorization: Bearer` of `x-api-key`
