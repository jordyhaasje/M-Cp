# System Flow (Runtime & Integratie)
Doelgroep: repo maintainers en AI-agents.

Dit document beschrijft hoe requests, authenticatie, section cloning en store-integraties op de actuele codebase functioneren.

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
De service in `apps/hazify-mcp-remote/src/index.js` luistert op HTTP transport.
1. Een request bevat een token via `Authorization: Bearer` of `x-api-key`.
2. Indien aanwezig wordt `Origin` gevalideerd tegen de allowlist.
3. De remote doet token-introspectie via de License Service en controleert licentie, tool-entitlements en mutation scopes.
4. Shopify token exchange gebeurt **lazy**: pas vlak voor een toolcall die Shopify echt nodig heeft.
5. `initialize` en `tools/list` blijven daardoor snel en contextvrij.

## 4. Toolcatalogus
<!-- BEGIN: TOOLS_LIST -->
- **`add-tracking-to-order`**: Alias of set-order-tracking. Kept for compatibility.
- **`analyze-reference-ui`**: Low-level diagnostic reference analysis for Shopify section generation. The tool fetches an external URL as compact DOM guidance, strips heavy tags, preserves structural IDs/classes and inline SVG markup, returns token-efficient Pug-like markup, adds a structured referenceSpec including interaction/control hints, and returns an actionable sectionPlan. Prefer prepare-section-from-reference as the default entrypoint for new sections; use analyze-reference-ui directly for selector-scoped debugging or narrow reference inspection.
- **`apply-theme-draft`**: Apply a previously drafted theme artifact to an explicit target theme. This is the promote/apply step after draft-theme-artifact has prepared and verified the files.
- **`clone-product-from-url`**: Clone a public Shopify product URL into your connected store with options, variants, prices and media.
- **`create-product`**: Create a new product. When using productOptions, Shopify registers all option values but only creates one default variant (first value of each option, price $0). Use manage-product-variants with strategy=REMOVE_STANDALONE_VARIANT afterward to create all real variants with prices.
- **`delete-product`**: Delete a product
- **`delete-product-variants`**: Delete one or more variants from a product
- **`delete-theme-file`**: Delete a file from a Shopify theme (defaults to live theme role=main).
- **`draft-theme-artifact`**: Draft and validate Shopify theme files through the guarded preview pipeline. This is the only supported remote create/update path for theme artifacts: files are inspected, linted, stored in theme_drafts, pushed to a preview-safe target by default, and verified after write before they are ready for merchant review.

⚠️ EXTREMELY CRITICAL STRICT CODE GENERATION RULES ⚠️
Rule 1 (UI/UX): Code MUST represent modern, premium Shopify 2.0 UI. NEVER use visible native scrollbars (::-webkit-scrollbar { display: none; }). Use modern CSS (scroll-snap-type, display: grid, gap, aspect-ratio).
Rule 2 (Dynamic Schema): NEVER hardcode texts, colors, or image URLs in the HTML. EVERY visual element MUST be bound to a setting in the {% schema %} (using color_picker, image_picker, text, richtext, range for spacing/layout controls).
Rule 3 (Blocks): Sliders, grids, and galleries MUST use the blocks architecture so merchants can add/remove/reorder content in the editor.
Rule 4 (Presets): Every section MUST have a complete presets array with default blocks so it appears in the Theme Editor.
Rule 5 (Shopify Constraints): Do not place Liquid inside {% stylesheet %} or {% javascript %}; use <style> or markup-level CSS variables when section.id scoping is required.
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
- **`list_theme_import_tools`**: List metadata/advice for external tools used outside this remote MCP for visual review workflows. Do not use this for the normal remote draft/apply flow.
- **`manage-product-options`**: Create, update, or delete product options (e.g. Size, Color). Use action='create' to add options, 'update' to rename or add/remove values, 'delete' to remove options.
- **`manage-product-variants`**: Create or update product variants. Omit variant id to create new, include id to update existing.
- **`prepare-section-from-reference`**: Default preparation tool for new Shopify sections from a reference URL. It identifies the intended subsection using an optional sectionHint or targetHeading, enriches the reference via analyze-reference-ui, and returns a component-aware sectionBlueprint with structure, controls, media, animation and layout hints plus a direct nextAction for draft-theme-artifact. Image inputs remain hints or QA context only.
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

## 5. Section Clone Workflows
### Nieuwe section uit reference
- Flow: `prepare-section-from-reference` -> `draft-theme-artifact`
- Dit is de standaardflow voor een nieuwe section op basis van een reference URL.
- Gebruik voor nieuwe sections uit een reference niet standaard `get-themes`, `search-theme-files` of `get-theme-file`.
- Geef bij multi-section pagina's bij voorkeur een `sectionHint` of `targetHeading` mee zodat de juiste subsection gekozen wordt.
- Een `sectionHint` mag een heading, componentnaam of korte descriptor zijn; de prepare-flow weegt headings, ids/classes en interactieve layoutsignalen mee om de beste subsection te kiezen.
- `prepare-section-from-reference` retourneert nu `sectionPlan`, `sectionBlueprint`, `selectionEvidence`, `suggestedFiles`, `generationHints`, `nextAction`, `errorCode` en `retryable`, zodat de LLM minder hoeft te gokken.
- `sectionBlueprint` bevat naast structuur nu ook `componentType`, `controlModel`, `animationModel`, `mediaModel` en `merchantEditableStyleModel`.
- Gebruik `analyze-reference-ui` alleen voor low-level diagnose of expliciete selector-scoping.
- URL-first met image hint is de ondersteunde route.
- Image-only cloning wordt nog niet ondersteund zonder extra multimodale stap.

### Bestaande theme edit
- Flow: `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`
- Gebruik deze flow voor aanpassingen aan bestaande theme-bestanden of reeds bestaande sections.

## 6. Theme Import Beleid & Preview Pipeline
1. Theme create/update loopt via `draft-theme-artifact`.
2. `draft-theme-artifact` inspecteert, lint en verifieert writes en schrijft standaard preview-first naar een `development` theme.
3. Live of ander target toepassen gebeurt pas via `apply-theme-draft` met expliciete confirmation.
4. `list_theme_import_tools` is adviserend voor externe tooling en geen vervanging voor de native draft/apply flow.
5. `prepare-section-from-reference` gebruikt intern een lichte Cheerio-analyse plus optionele visual worker verrijking via `analyze-reference-ui`.
6. De visual worker is URL-based fidelity-verrijking. Hij begrijpt nog geen image-only cloning.
7. De visual worker verrijkt references nu met runtime layout-signalen zoals zichtbare slides per breakpoint, arrows, dots, logo/icon presence en transition-signalen wanneer de browseranalyse beschikbaar is.

## 7. Shopify-conforme File Policy
- Standaard maakt de LLM alleen `sections/<handle>.liquid`.
- Voeg alleen `snippets/` toe als markup of logica echt herhaald wordt.
- Voeg alleen `blocks/` files toe als je bewust theme blocks nodig hebt.
- Voeg alleen `locales/*.json` toe bij vaste, niet-merchant-editable UI strings.
- Maak geen assets standaard; gebruik component-scoped CSS/JS in de section zelf.
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`.
- Merchant placement blijft via de Theme Editor; automatische template/config writes blijven verboden.

## 8. Veiligheid, Rate Limiting & Tool Hardening
1. **Tenant isolation:** Toolcalls blijven strikt aan de juiste shop en tenant gekoppeld.
2. **Tool hardening:** Destructieve of financiële mutaties vereisen expliciete `confirmation` strings en vaak ook `reason`.
3. **JSON safeguard:** `templates/*.json` en `config/*.json` writes blijven geblokkeerd in de section-clone flow.
4. **Core file protection:** `layout/theme.liquid` mag `content_for_header` en `content_for_layout` niet verliezen.
5. **Batch limiet:** Maximaal 10 theme-bestanden per request.
6. **Distributed locks:** Theme writes gebruiken PostgreSQL advisory locks om parallelle conflicts te voorkomen.
7. **Reference observability:** De remote logt analysemodus, workergebruik, fallback-reden en latency-bucket voor `analyze-reference-ui`.
