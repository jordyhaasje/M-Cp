# System Flow (Runtime & Integratie)
Doelgroep: repo maintainers en AI-agents.

Dit document beschrijft hoe aanvragen, authenticatie en store integraties op de actuele codebase functioneren.

## 1. Onboarding & Credentials
1. Een gebruiker registreert zich op de License Service en koppelt zijn Shopify winkel via `shopAccessToken` of `shopClientId` / `shopClientSecret`.
2. Validatie controleert op `REQUIRED_SHOPIFY_ADMIN_SCOPES` (inclusief `read_themes`, `write_themes`).
3. Credentials en secrets blijven **100% server-side** op de License Service en worden nooit via de frontend aan de MCP client doorgegeven.

## 2. Authenticatie: OAuth PKCE (Voorkeur) & Fallback
Vanaf 2026 ondersteunt Hazify native OAuth 2.0 PKCE.
1. **Discovery:** Client ontdekt auth servers via `/.well-known/oauth-protected-resource`.
2. **Authorize Flow:** `GET /oauth/authorize` levert de visuele login pagina. Toestemming (of weigering) gaat via een specifieke form submit op `POST /oauth/authorize`.
   - De authorize submit (POST) onthoudt de *originele* OAuth-parameters, inclusief de `resource` parameter.
   - Origin van `redirect_uri` wordt in de CSP `form-action` geladen, zodat redirects naar platforms zoals `https://chatgpt.com` netjes lukken.
3. **Token:** `/oauth/token` wisselt autorisatiecode in voor access tokens.
*(Fallback: API tools tokens gegenereerd op het web dashboard zijn bruikbaar voor pure API of legacy connectors.)*

## 3. Remote MCP Request Lifecycle (`/mcp`)
De service (`mcp-remote/src/index.js`) luistert op het HTTP-transport.
1. Een request bevat een token (via Bearer of `x-api-key`). Geen query parameters.
2. Controle op `Origin` (indien meegeleverd) versus allowlist in `isOriginAllowed`.
3. Verificatie via introspection aan de license service (`/v1/mcp/token/introspect`). Check licentiestatus en tool/mutation entitlements (`context.license.entitlements.tools`, etc).
4. **Lazy Token Exchange:** Shopify-autorisatie (`/v1/mcp/token/exchange`) vindt alleen plaats vóór evaluatie van een tool die écht met Shopify moet babbelen. De aanroepen naar MCP's `initialize` en `tools/list` omzeilen dit en zijn zeer snel.
5. De operatie wordt gelimiteerd door in-memory scopes (o.a. `mcp:tools:read` vs `mcp:tools:write`).

## 4. Theme Import Beleid & Tools
De Remote MCP implementeert **géén eigen browser runtime of local generation**. 

<!-- BEGIN: TOOLS_LIST -->
- **`add-tracking-to-order`**: Alias of set-order-tracking. Kept for compatibility.
- **`analyze-reference-ui`**: Fetch and analyze an external reference URL as compact DOM guidance for Shopify section generation. The tool strips heavy tags, preserves structural IDs/classes and inline SVG markup, returns token-efficient Pug-like markup, and adds a structured referenceSpec. When visual analysis is enabled it can enrich the result through the visual worker.
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
Rule 5 (Mobile First): Always include responsive CSS (media queries) so the layout adapts flawlessly to mobile.
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

1. **Resolve en Read First:** Om tokenoverhead en foutieve edits te minimaliseren:
   - Identificeer altijd eerst via `search-theme-files` voordat je een bestand opent of wijzigt.
   - Gebruik `get-theme-file` / `get-theme-files` pas nadat het juiste target-bestand is bevestigd.
2. **Guarded Preview Flow:** Theme create/update loopt via `draft-theme-artifact`. Die tool inspecteert, lint en verifieert writes en schrijft standaard preview-first naar een `development` theme.
3. **Explicit Apply Flow:** Live of ander target toepassen gebeurt pas via `apply-theme-draft` met expliciete bevestiging.
4. **Externe review tooling:** Metadata over lokale externe tools is opvraagbaar via `list_theme_import_tools`. Dit is adviserend en geen vervanging voor de native draft/apply flow.
5. **Visuele UI Scrapen (Referenties):** `analyze-reference-ui` gebruikt een lichte Cheerio-analyse en kan optioneel worden verrijkt via de visual worker. De output bevat compacte markup plus een gestructureerde `referenceSpec` voor hogere fidelity.
6. **Theme Development Best Practices (LLM Instructies):**
   - **Stop Guessing:** AI-agents mogen NOOIT blind gokken naar bestandsnamen zoals 'base.css' of 'product.json'. Ze moeten verplicht `search-theme-files` gebruiken.
   - **Asset Registration:** Als de AI een nieuw CSS/JS asset aanmaakt, weet het dat Shopify dit niet automatisch inlaadt. Het moet expliciet gekoppeld worden in de layout (bijv. in `layout/theme.liquid` via `{{ 'filename.css' | asset_url | stylesheet_tag }}`).

Model: `AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`

## 5. Veiligheid, Rate Limiting & Tool Hardening

De Remote MCP beschikt over diepliggende veiligheidsmechanismen tegen malformatie en LLM-hallucinaties:
1. **Tenant Isolation:** Iedere integratie en tool call is strict geïsoleerd op de shop en tenant van de gekoppelde GraphQL/REST sessie. Cross-tenant data leakages door AI LLM-hallucineren is hiermee op netwerk- en applicatieniveau fundamenteel geblokkeerd.
2. **Tool Hardening (Zod Validaties):** Gevaarlijke of destructieve mutaties vereisen expliciete `confirmation` strings en een `reason`. Voor de theme-flow zijn dat nu `"APPLY_THEME_DRAFT"` en `"DELETE_THEME_FILE"`. Als argumenten missen of invalid zijn, blokkeert Zod de API call. *(Voor AI-agents: "OpenAI safety check" errors tijdens writes betekenen vrijwel altijd een gefaalde Zod validatie. Controleer de schema-argumenten via `AGENTS.md`.)*
3. **Smart JSON Safeguard:** Via API JSON templates aanmaken of wijzigen (`templates/*.json` en `config/*.json`) is een harde blokkade, ter bescherming van homepage destructie. De LLM stuurt losse theme bestanden aan, waarna de merchant zélf via z'n Theme Editor kan plaatsen.
4. **Core File Protection:** Kritieke infrastructuur-bestanden (zoals `layout/theme.liquid`) blokkeren API saves indien vitale tags, specifiek `{{ content_for_header }}` en `{{ content_for_layout }}`, ontbreken in de payload. Ze mogen bovendien nooit via integraties verwijderd worden.
5. **API Rate Limiting & Batch Limits (Exponential Backoff):** Om OOM-crashes en timeouts op Railway te voorkomen, is er op alle theme opslag- en leesoperaties een **harde limiet van maximaal 10 bestanden** ingesteld per request. Theme-operaties hergebruiken automatische interne *Exponential Backoff* mechanismes om HTTP 429-errors netjes af te vangen.
6. **Distributed Concurrency Locks:** Om concurrerende wijzigingen in single-files over meerdere applicatie-containers (op Railway) veilig te serialiseren, wordt er voor iedere theme schrijfoperatie een deterministische *PostgreSQL Advisory Lock* afgedwongen (i.p.v. memory-locks). Toekomstige draft-edits en staging logica steunen op the PostgreSQL `theme_drafts` backend tabel voor schaalbare integratie.
7. **Defense in Depth (LLM Hallucinations):** Systeem-tools combineren agressieve Zod schema-validaties, guarded preview writes, verify-after-write en draft-statusregistratie in `theme_drafts` om parameter-fouten en onveilige live writes tegen te houden.
