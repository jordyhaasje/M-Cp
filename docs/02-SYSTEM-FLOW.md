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
- **`apply-theme-draft`**: Apply a previously drafted theme artifact to an explicit target theme. This is the promote/apply step after draft-theme-artifact has prepared and verified the files. themeId of themeRole is verplicht; kies nooit stilzwijgend een live target.
- **`clone-product-from-url`**: Clone a public Shopify product URL into your connected store with options, variants, prices and media.
- **`create-product`**: Create a new product. When using productOptions, Shopify registers all option values but only creates one default variant (first value of each option, price $0). Use manage-product-variants with strategy=REMOVE_STANDALONE_VARIANT afterward to create all real variants with prices.
- **`delete-product`**: Delete a product
- **`delete-product-variants`**: Delete one or more variants from a product
- **`delete-theme-file`**: Delete a file from a Shopify theme. themeRole of themeId is verplicht — vraag de gebruiker welk thema.
- **`draft-theme-artifact`**: Draft and validate Shopify theme files through the guarded pipeline.

Modes:
- mode="create": Volledige inspectie voor nieuwe sections (geldig schema, presets, renderbare markup en Shopify-veilige range settings). Templates/config geblokkeerd.
- mode="edit": Lichtere inspectie voor wijzigingen aan bestaande bestanden. Templates/config TOEGESTAAN met JSON/JSONC-validatie, en sections/blocks met schema krijgen ook range-validatie.

Beide modes: Liquid-in-stylesheet check, theme-check linting, layout/theme.liquid bescherming.

Belangrijk: themeRole of themeId is verplicht. Vraag de gebruiker welk thema als dit niet is opgegeven.

Theme-aware section regels:
- Gebruik voor bestaande single-file edits bij voorkeur patch-theme-file. Gebruik draft-theme-artifact vooral voor multi-file edits, nieuwe sections en volledige rewrites.
- Compatibele shorthand: voor één file mag een client ook top-level key + value of key + searchString/replaceString aanleveren; dit wordt intern naar files[] genormaliseerd. Als een compatibele client alleen _tool_input_summary meestuurt voor theme target of exact file path, probeert de tool die info daaruit af te leiden; legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund.
- Gebruik plan-theme-edit voordat je native product-blocks, theme blocks of template placement probeert. Zo weet je eerst of het theme een single-file patch, multi-file edit of losse section-flow nodig heeft.
- Nieuwe sections worden vooraf gecontroleerd op Shopify schema-basisregels, waaronder geldige range defaults binnen min/max, geldige step-alignment en maximaal 101 stappen per range setting.
- Nieuwe blocks/*.liquid files krijgen in create mode ook een basisinspectie op geldige schema JSON en block-veilige markup.
- Gebruik setting type "video" voor merchant-uploaded video bestanden. Gebruik "video_url" alleen voor externe YouTube/Vimeo URLs.
- Gebruik "color_scheme" alleen als het doeltheme al globale color schemes heeft in config/settings_schema.json + config/settings_data.json. Anders: gebruik simpele "color" settings of patch die config eerst in een aparte mode="edit" call.
- Voor native blocks binnen een bestaande section (bijv. product-info of main-product): gebruik mode="edit" en patch de bestaande schema.blocks plus de render markup/snippet. Dit is geen los blocks/*.liquid bestand.
- Als de gebruiker een nieuwe section ook op een homepage/productpagina geplaatst wil hebben, maak eerst sections/<handle>.liquid in mode="create" en doe daarna alleen bij expliciete placement-vraag een aparte mode="edit" call voor templates/*.json op hetzelfde expliciet gekozen thema. Gebruik config/settings_data.json alleen als uitzonderingsroute.
- Gebruik voor nieuwe sections bij voorkeur enabled_on/disabled_on in de schema in plaats van legacy "templates" wanneer je beschikbaarheid per template wilt sturen.

Rules for valid Shopify Liquid:

Do not place Liquid inside {% stylesheet %} or {% javascript %}

Use <style> or markup-level CSS variables for section.id scoping
- **`get-customer-orders`**: Get orders for a specific customer
- **`get-customers`**: Get customers or search by name/email
- **`get-license-status`**: Return current license status, effective access, and MCP scope capabilities.
- **`get-order-by-id`**: READ-ONLY: fetch a specific order and tracking status. Does not update anything.
- **`get-orders`**: READ-ONLY: get orders with optional filtering by status. Supports cursor pagination.
- **`get-product-by-id`**: Get a specific product by ID
- **`get-products`**: Get all products or search by title
- **`get-supported-tracking-companies`**: Get Shopify-supported tracking carriers that can be selected in the order fulfillment tracking UI
- **`get-theme-file`**: Read one exact file from a Shopify theme. Deze read-only tool valt voor backwards compatibility terug op main als themeId/themeRole ontbreekt, maar gebruik in elke editflow bij voorkeur hetzelfde expliciete target als in plan-theme-edit en je uiteindelijke write. Lees dit liefst na plan-theme-edit, en alleen de compacte exact keys die de planner voorstelt. Voor native product-block flows hoef je templates/*.json na plan-theme-edit meestal niet opnieuw te lezen tenzij placement van het block expliciet gevraagd is. Handige reads zijn bijvoorbeeld sections/main-product.liquid, snippets/product-info.liquid of templates/product.json.
- **`get-theme-files`**: Read EXACT files from a Shopify theme. GEEN GLOBBING. Deze read-only tool valt voor backwards compatibility terug op main als themeId/themeRole ontbreekt, maar gebruik in elke editflow bij voorkeur hetzelfde expliciete target als in plan-theme-edit en je write-call. Gebruik altijd search-theme-files als je niet 100% zeker bent van de file path. Gebruik dit bij voorkeur na plan-theme-edit, zodat je alleen de exact voorgestelde files leest. Voor native product-block flows zijn dat meestal sections + snippets; lees templates/*.json daarna alleen opnieuw als placement van het block expliciet gevraagd is. Handig voor bewuste multi-read workflows zoals ['sections/main-product.liquid', 'snippets/product-info.liquid'] of ['templates/product.json'].
- **`get-themes`**: List available Shopify themes (including the live theme).
- **`manage-product-options`**: Create, update, or delete product options (e.g. Size, Color). Use action='create' to add options, 'update' to rename or add/remove values, 'delete' to remove options.
- **`manage-product-variants`**: Create or update product variants. Omit variant id to create new, include id to update existing.
- **`patch-theme-file`**: Patch one existing theme file met één of meer letterlijke vervangingen. Dit is de voorkeursroute voor smalle single-file edits in bestaande snippets, sections, assets, config of templates wanneer je het exacte targetbestand al weet. Gebruik een unieke searchString die exact één keer voorkomt; bij twijfel eerst plan-theme-edit. Niet bedoeld voor native product-block flows die section + snippet tegelijk raken. Geef altijd hetzelfde expliciete themeId of themeRole mee als in je read-flow. Compatibele shorthand: key + searchString + replaceString op top-level wordt automatisch naar patch genormaliseerd. Als een compatibele client alleen _tool_input_summary meestuurt voor theme target of exact file path, probeert de tool die info daaruit af te leiden; legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund.
- **`plan-theme-edit`**: Plan een theme edit voordat je bestanden leest of schrijft. Gebruik dit eerst voor native product-blocks, blocks in bestaande sections, template placement of wanneer je tokenzuinig exact wilt weten welke files je moet lezen. De output geeft een compacte theme-aware strategie terug: patch-existing, multi-file-edit, create-section of template-placement, plus de exacte volgende read/write keys. Voor native product-blocks analyseert de planner templates/*.json al zelf; reread dat template daarna alleen als placement expliciet gevraagd is. Bij compatibele clients mag een korte _tool_input_summary ook; de planner probeert daaruit intent, template en theme target af te leiden. Legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund.
- **`refund-order`**: Create a full or partial refund for an order using Shopify refundCreate.
- **`search-theme-files`**: Search scoped theme files and return compact snippets instead of full file dumps. Deze read-only tool valt voor backwards compatibility terug op main als themeId/themeRole ontbreekt, maar gebruik in elke editflow bij voorkeur hetzelfde expliciete target als in plan-theme-edit en je write-call. Gebruik dit eerst om een exacte, unieke patch-anchor of bestaand renderpad te vinden voordat je leest of schrijft. Voor native product-blocks of template placement gebruik je bij voorkeur eerst plan-theme-edit, en zoek je daarna alleen in de voorgestelde scope of exact keys. Bij compatibele clients mag een korte _tool_input_summary ook; die wordt dan als query gebruikt en de scope wordt waar mogelijk automatisch vernauwd. Legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund. Minimaal geldig voorbeeld: { query: 'buy_buttons', scope: ['sections', 'snippets'] }, { query: 'block.type', keys: ['sections/main-product.liquid', 'snippets/product-info.liquid'] } of { query: 'main-product', filePatterns: ['sections/*.liquid'] }.
- **`set-order-tracking`**: One-shot tracking update tool for LLMs: resolves order reference, updates fulfillment tracking, and returns verification-ready output.
- **`update-customer`**: Update a customer's information. Let op: acceptsMarketing wordt momenteel door Shopify genegeerd in deze mutation.
- **`update-fulfillment-tracking`**: Update order shipment tracking in the actual fulfillment record (not custom attributes/metafields). fulfillmentId is optional; when omitted, the latest non-cancelled fulfillment is updated automatically.
- **`update-order`**: Update an existing order with new information. Gebruik voor shipment tracking bij voorkeur set-order-tracking of update-fulfillment-tracking; gebruik deze tool niet als primaire tracking workflow.
- **`update-order-tracking`**: Alias of set-order-tracking. Kept for compatibility.
- **`update-product`**: Update an existing product's fields (title, description, status, tags, etc.)
- **`verify-theme-files`**: Verify multiple theme files by expected metadata (size/checksumMd5). Deze read-only tool valt voor backwards compatibility terug op main als themeId/themeRole ontbreekt, maar gebruik in elke editflow bij voorkeur hetzelfde expliciete target als in je planner/read/write-flow. Minimaal geldig voorbeeld: { expected: [{ key: 'sections/hero.liquid', checksumMd5: '...' }] }.
<!-- END: TOOLS_LIST -->

## 5. Theme Editing Pipeline
- Bestaande theme edit: `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`
- Theme create/update loopt via `draft-theme-artifact`.
  Voor native product-blocks, theme blocks en template placement start je eerst met `plan-theme-edit` op hetzelfde expliciete theme. Die planner geeft compact terug of je een single-file patch, multi-file edit of create-section flow nodig hebt.
1. Zoek de gewenste code met `search-theme-files` om een betrouwbare `searchString` te verkrijgen. Gebruik na `plan-theme-edit` bij voorkeur exact de `nextReadKeys`, zodat je compact binnen section/snippet-bestanden zoekt in plaats van hele templates opnieuw te lezen.
2. Lees daarna met `get-theme-file` alleen het exacte doelbestand in dat je gaat aanpassen. Voor native product-blocks is dat meestal de bestaande section en eventuele snippet renderer; herlees `templates/*.json` alleen als placement expliciet gevraagd is.
3. Voer de edit uit via `draft-theme-artifact` in `mode="edit"`. Gebruik bij voorkeur `patch` voor één gerichte wijziging of `patches` voor meerdere sequentiële wijzigingen in hetzelfde bestand om token-verbruik te beperken en truncation te voorkomen. De pipeline valideert section/block schema-ranges nu ook vooraf op bounds, step-alignment en maximaal 101 stappen.
   Voor kleine single-file edits op bestaande bestanden kan ook `patch-theme-file` worden gebruikt.
   Voor native blocks in bestaande sections betekent dit meestal: patch de bestaande `schema.blocks` plus de render markup/snippet; dit is normaal geen `blocks/*.liquid` flow.
4. Live of ander target toepassen gebeurt via `apply-theme-draft` met expliciete confirmation.
5. Verifieer writes via de `verify` output van `draft-theme-artifact` of aanvullend met `verify-theme-files` of `get-theme-file`.
6. Als een gebruiker placement op homepage/producttemplate expliciet vraagt, doe dat als aparte `mode="edit"` wijziging op het juiste `templates/*.json` bestand van hetzelfde gekozen theme.

## 6. Shopify-conforme File Policy
- Beperk writes tot de noodzakelijke theme-bestanden; voor section-wijzigingen is dat meestal `sections/<handle>.liquid`.
- Nieuwe sections moeten naast een geldig `{% schema %}` block ook renderbare markup bevatten; schema-only of style-only stubs worden geblokkeerd.
- Voeg alleen `snippets/` toe als markup of logica echt herhaald wordt.
- Voeg alleen `blocks/` files toe als je bewust theme blocks nodig hebt.
- Voeg alleen `locales/*.json` toe bij vaste, niet-merchant-editable UI strings.
- Maak geen assets standaard; gebruik component-scoped CSS/JS in de section zelf.
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`.
- `templates/*.json` en `config/*.json` writes zijn alleen toegestaan in `mode="edit"` en worden onderworpen aan JSON/JSONC-validatie (met controle op verplichte `sections`/`order`/`current` datastructuren). In `mode="create"` blijven deze verboden.
- Merchant placement van nieuwe secties blijft bij voorkeur via de Theme Editor plaatsvinden indien er geen bestaande flow is.

## 7. Veiligheid, Rate Limiting & Tool Hardening
1. **Tenant isolation:** Toolcalls blijven strikt aan de juiste shop en tenant gekoppeld.
2. **Tool hardening:** Destructieve of financiële mutaties vereisen expliciete `confirmation` strings en vaak ook `reason`.
3. **Core file protection:** `layout/theme.liquid` mag `content_for_header` en `content_for_layout` niet verliezen.
4. **Truncation Protection:** In `mode="edit"` blokkeert de pipeline automatisch schrijfacties die leiden tot >50% bestandverkleining of verlies van kritieke JSON-velden (zoals `sections` in templates).
5. **Linter Resilience:** De `theme-check` linter is zo afgesteld dat externe ontbrekende snippet-fouten de write niet blokkeren, maar als warnings worden weergegeven.
6. **Distributed locks:** Theme writes gebruiken PostgreSQL advisory locks om parallelle conflicts te voorkomen.
