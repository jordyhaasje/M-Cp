# System Flow (Runtime & Integratie)
Doelgroep: repo maintainers en AI-agents.

Dit document beschrijft hoe requests, authenticatie, theme editing en store-integraties op de actuele codebase functioneren.

## 1. Onboarding & Credentials
1. Een gebruiker registreert zich op de License Service en koppelt Shopify via `shopAccessToken` of `shopClientId` / `shopClientSecret`.
2. Validatie controleert op `REQUIRED_SHOPIFY_ADMIN_SCOPES`, inclusief `read_themes` en `write_themes`.
3. Credentials en secrets blijven server-side op de License Service en worden nooit aan de MCP client doorgegeven.

## 2. Authenticatie: OAuth PKCE & Fallback
Vanaf 2026 ondersteunt Hazify native OAuth 2.0 PKCE.
1. **Discovery:** Client ontdekt auth servers via `/.well-known/oauth-protected-resource`.
2. **Authorize flow:** `GET /oauth/authorize` levert de login pagina; `POST /oauth/authorize` handelt toestemming of weigering af.
3. **Token:** `/oauth/token` wisselt de autorisatiecode in voor access tokens.

Fallback: dashboard-tokens blijven bruikbaar voor pure API of legacy connectors.

## 3. Remote MCP Request Lifecycle (`/mcp`)
De service in `apps/hazify-mcp-remote/src/index.js` luistert alleen op Streamable HTTP.
1. Een request bevat een token via `Authorization: Bearer` of `x-api-key`.
2. Indien aanwezig wordt `Origin` gevalideerd tegen de allowlist.
3. De remote doet token-introspectie via de License Service en controleert licentie, tool-entitlements en mutation scopes.
4. Shopify token exchange gebeurt **lazy**: pas vlak voor een toolcall die Shopify echt nodig heeft.
5. Theme draft persistence en file locks lopen via PostgreSQL; er is geen runtime fallback naar in-memory opslag.
6. `initialize` en `tools/list` blijven daardoor snel en contextvrij.

## 4. Toolcatalogus
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

## 5. Theme Editing Pipeline
- Bestaande theme edit: `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`
1. Theme lezen via `get-theme-file`, `get-theme-files`, of `search-theme-files`.
2. Theme create/update loopt via `draft-theme-artifact`.
3. Live of ander target toepassen gebeurt via `apply-theme-draft` met expliciete confirmation.
4. Verifieer writes via de `verify` output van `draft-theme-artifact` of aanvullend met `verify-theme-files`.

## 6. Shopify-conforme File Policy
- Beperk writes tot de noodzakelijke theme-bestanden; voor section-wijzigingen is dat meestal `sections/<handle>.liquid`.
- Voeg alleen `snippets/` toe als markup of logica echt herhaald wordt.
- Voeg alleen `blocks/` files toe als je bewust theme blocks nodig hebt.
- Voeg alleen `locales/*.json` toe bij vaste, niet-merchant-editable UI strings.
- Maak geen assets standaard; gebruik component-scoped CSS/JS in de section zelf.
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`.
- `templates/*.json` en `config/*.json` writes blijven verboden in deze flow.
- Merchant placement blijft via de Theme Editor; automatische template/config writes blijven verboden.

## 7. Veiligheid, Rate Limiting & Tool Hardening
1. **Tenant isolation:** Toolcalls blijven strikt aan de juiste shop en tenant gekoppeld.
2. **Tool hardening:** Destructieve of financiële mutaties vereisen expliciete `confirmation` strings en vaak ook `reason`.
3. **Core file protection:** `layout/theme.liquid` mag `content_for_header` en `content_for_layout` niet verliezen.
4. **Distributed locks:** Theme writes gebruiken PostgreSQL advisory locks om parallelle conflicts te voorkomen.
