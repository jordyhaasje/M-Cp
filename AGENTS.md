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
- Canonical gedeelde packages staan in `packages/`
- Railway deploy mirrors voor runtime-kritieke packages staan bewust onder `apps/hazify-license-service/packages/` en `apps/hazify-mcp-remote/packages/`
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
2. Gebruik voor gewone bestaande single-file theme edits de flow `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`.
3. Gebruik voor nieuwe losse sections bij voorkeur `create-theme-section`; gebruik voor native product-blocks, theme blocks en template placement eerst `plan-theme-edit`, en lees/schrijf daarna alleen de exact voorgestelde files.

## Shopify taken
Gebruik altijd de actieve MCP tools uit de gedeelde registry. Beschikbare tools voor API-interacties worden hieronder dynamisch bijgehouden.

<!-- BEGIN: TOOLS_LIST -->
- **`add-tracking-to-order`**: One-shot tracking update tool for LLMs: resolves order reference, updates fulfillment tracking, and returns verification-ready output.
- **`apply-theme-draft`**: Apply a previously drafted theme artifact to an explicit target theme. Dit is de promote/apply stap nadat `draft-theme-artifact` of `create-theme-section` eerst een echte draft/write heeft voorbereid en geverifieerd. Gebruik deze tool dus niet om een nieuwe section voor het eerst te schrijven. `themeId` of `themeRole` is verplicht; kies nooit stilzwijgend een live target.
- **`clone-product-from-url`**: Clone a public Shopify product URL into your connected store with options, variants, prices and media.
- **`create-product`**: Create a new product. When using productOptions, Shopify registers all option values but only creates one default variant (first value of each option, price $0). Use manage-product-variants with strategy=REMOVE_STANDALONE_VARIANT afterward to create all real variants with prices.
- **`create-theme-section`**: Maak een nieuwe Shopify section in `sections/<handle>.liquid`. Dit is de primaire eerste write-tool voor nieuwe sections en een duidelijke wrapper rond de guarded create-flow. Gebruik deze dus vóór `apply-theme-draft`; die tool is alleen bedoeld voor een bestaand opgeslagen draftId. Vereist: expliciet `themeId` of `themeRole`, exact één section-bestand (`key` of `handle`) en de volledige Liquid-inhoud. Lees na `plan-theme-edit` eerst de exacte `nextReadKeys` in; deze tool weigert nu create-writes zolang die verplichte theme-context reads nog niet met `includeContent=true` zijn gebeurd. Zo blijft de generatie afgestemd op bestaande wrappers, helpers, schaalconventies en inherited classes van het doeltheme. De tool normaliseert veilige compat-velden zoals `targetFile`, `content`, `liquid` en `_tool_input_summary`, maar vrije summary-tekst mag nooit de daadwerkelijke code vervangen. Intern leidt de tool eerst compacte theme-context én section-category metadata af via `plan-theme-edit`-achtige logica of recente planner-memory, zodat create-validatie niet blind op hero-schaal aannames of parser-onveilige JS/Liquid patronen schrijft. Exacte screenshot/design-replica prompts blijven daardoor in precision-first mode wanneer dezelfde flow net al gepland was. Daarna gebruikt deze tool `draft-theme-artifact mode="create"`, inclusief lokale schema-inspectie, theme-check lint, theme-scale sanity checks, interactieve/media guardrails en preview-write validatie.
- **`delete-product`**: Delete a product
- **`delete-product-variants`**: Delete one or more variants from a product
- **`delete-theme-file`**: Delete a file from a Shopify theme. themeRole of themeId is verplicht — vraag de gebruiker welk thema.
- **`draft-theme-artifact`**: Draft and validate Shopify theme files through the guarded pipeline.

Modes:
- mode="create": Volledige inspectie voor nieuwe sections (geldig schema, presets, renderbare markup en Shopify-veilige range settings). Templates/config geblokkeerd.
- mode="edit": Lichtere inspectie voor wijzigingen aan bestaande bestanden. Templates/config TOEGESTAAN met JSON/JSONC-validatie, en sections/blocks met schema krijgen ook range-validatie.

Zet mode altijd expliciet op top-level. Alleen voor backwards compatibility infereren patch/patches automatisch mode="edit"; value-only writes zonder mode worden eerst tegen het doeltheme geprobed zodat bestaande bestanden niet stilzwijgend als create-flow worden behandeld.

Beide modes: Liquid-in-stylesheet check, theme-check linting, layout/theme.liquid bescherming.

Belangrijk: themeRole of themeId is verplicht. Vraag de gebruiker welk thema als dit niet is opgegeven.

Theme-aware section regels:
- Gebruik voor bestaande single-file edits bij voorkeur patch-theme-file. Gebruik draft-theme-artifact vooral voor multi-file edits, nieuwe sections en volledige rewrites.
- Compatibele shorthand: voor één file mag een client ook top-level key + value/content/liquid of key + searchString/replaceString aanleveren; dit wordt intern naar files[] genormaliseerd. Binnen files[] worden value/content/liquid nu ook veilig naar dezelfde canonieke value-write genormaliseerd. Als een compatibele client alleen _tool_input_summary meestuurt, infereren we daaruit hooguit theme target en exact file path. Vrije summary-tekst vervangt NOOIT gestructureerde write-velden zoals files[], value, content, liquid, patch of patches. Legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund.
- Gebruik plan-theme-edit voordat je native product-blocks, theme blocks of template placement probeert. Zo weet je eerst of het theme een single-file patch, multi-file edit of losse section-flow nodig heeft.
- Wanneer plan-theme-edit eerst exact nextReadKeys voorschrijft, verwacht deze tool nu dat die reads ook echt met includeContent=true zijn uitgevoerd voordat dezelfde write-flow doorgaat.
- Nieuwe sections worden vooraf gecontroleerd op Shopify schema-basisregels, waaronder geldige range defaults binnen min/max, geldige step-alignment en maximaal 101 stappen per range setting. Bij range-fouten geeft de tool exacte suggestedReplacement/default-hints terug.
- Wanneer de create-flow compacte theme-context heeft afgeleid, controleert de pipeline ook op hero-achtige oversizing van typography, spacing, gaps en min-heights ten opzichte van representatieve content sections in het doeltheme.
- richtext defaults moeten Shopify-veilige HTML gebruiken. Gebruik top-level <p> of <ul>; tags zoals <mark> in richtext.default worden door Shopify afgewezen.
- Nieuwe blocks/*.liquid files krijgen in create mode ook een basisinspectie op geldige schema JSON en block-veilige markup.
- Renderer-veilige Liquid blijft verplicht: geen geneste {{ ... }} of {% ... %} binnen dezelfde output-tag of filter-argumentstring; bouw zulke waarden eerst op via assign/capture en geef daarna de variabele door.
- Gebruik setting type "video" voor merchant-uploaded video bestanden. Gebruik "video_url" alleen voor externe YouTube/Vimeo URLs.
- Gebruik "color_scheme" alleen als het doeltheme al globale color schemes heeft in config/settings_schema.json + config/settings_data.json. Anders: gebruik simpele "color" settings of patch die config eerst in een aparte mode="edit" call.
- Voor native blocks binnen een bestaande section (bijv. product-info of main-product): gebruik mode="edit" en patch de bestaande schema.blocks plus de render markup/snippet. Dit is geen los blocks/*.liquid bestand.
- Als de gebruiker een nieuwe section ook op een homepage/productpagina geplaatst wil hebben, maak eerst sections/<handle>.liquid in mode="create" en doe daarna alleen bij expliciete placement-vraag een aparte mode="edit" call voor templates/*.json op hetzelfde expliciet gekozen thema. Gebruik config/settings_data.json alleen als uitzonderingsroute.
- Gebruik voor nieuwe sections bij voorkeur enabled_on/disabled_on in de schema in plaats van legacy "templates" wanneer je beschikbaarheid per template wilt sturen.
- Lokale inspectie en theme-check lint worden waar mogelijk samen als lokale preflight teruggegeven, zodat een retry meerdere deterministische fouten tegelijk kan repareren.

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
- **`get-theme-file`**: Read one exact file from a Shopify theme. Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je read-context overeenkomt met plan-theme-edit en je write-call. Alleen voor backwards compatibility valt deze read-tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Lees dit liefst na plan-theme-edit, en alleen de compacte exact keys die de planner voorstelt. Voor native product-block flows hoef je templates/*.json na plan-theme-edit meestal niet opnieuw te lezen tenzij placement van het block expliciet gevraagd is. Handige reads zijn bijvoorbeeld sections/main-product.liquid, snippets/product-info.liquid of templates/product.json.
- **`get-theme-files`**: Read EXACT files from a Shopify theme. GEEN GLOBBING. Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je read-context overeenkomt met plan-theme-edit en je write-call. Alleen voor backwards compatibility valt deze read-tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Gebruik altijd search-theme-files als je niet 100% zeker bent van de file path. Gebruik dit bij voorkeur na plan-theme-edit, zodat je alleen de exact voorgestelde files leest. Wanneer een planner-read content nodig heeft en includeContent ontbreekt, zet deze tool dat nu automatisch op true met een warning.
- **`get-themes`**: List available Shopify themes (including the live theme).
- **`manage-product-options`**: Create, update, or delete product options (e.g. Size, Color). Use action='create' to add options, 'update' to rename or add/remove values, 'delete' to remove options.
- **`manage-product-variants`**: Create or update product variants. Omit variant id to create new, include id to update existing.
- **`patch-theme-file`**: Patch one existing theme file met één of meer letterlijke vervangingen. Gebruik dit alleen voor kleine single-file fixes nadat je eerst met `search-theme-files` en daarna `get-theme-file` de exacte anchor hebt bepaald. Deze tool vereist nu eerst een recente exact-read met includeContent=true op hetzelfde bestand, weigert generieke of niet-unieke anchors en blokkeert bredere CSS/JS/schema rewrites die eigenlijk via draft-theme-artifact mode='edit' horen te lopen.
- **`plan-theme-edit`**: Plan een theme edit voordat je bestanden leest of schrijft. Geef bij voorkeur een expliciete intent mee (`existing_edit`, `native_block`, `new_section` of `template_placement`) plus een expliciet `themeId` of `themeRole`. Gebruik dit eerst voor native product-blocks, blocks in bestaande sections, template placement of wanneer je tokenzuinig exact wilt weten welke files je moet lezen. De output geeft een compacte theme-aware strategie terug: `patch-existing`, `multi-file-edit`, `create-section` of `template-placement`, plus de exacte volgende read/write keys. `nextTool` en `nextArgsTemplate` beschrijven nu de onmiddellijke volgende stap: meestal eerst `get-theme-file` of `get-theme-files` voor verplichte contextreads, en pas daarna de uiteindelijke write-tool via `writeTool` en `writeArgsTemplate`. Langere `query`- of `description`-prompts zijn toegestaan; de planner compacteert die intern naar een korte query voor tokenzuinige planning. Voor native product-blocks analyseert de planner `templates/*.json` al zelf; reread dat template daarna alleen als placement expliciet gevraagd is. Compatibele clients mogen ook `_tool_input_summary`, `description`, `type`, `intentType`, `intent_type` en `targetFiles` meesturen. Vrije summary-tekst mag alleen veilige inferentie doen voor intent, theme target, template en exact één bestaand `targetFile`. Wanneer in dezelfde flow net een section is aangemaakt, kunnen vervolgprompts zoals 'optimaliseer hem' of 'maak V2' automatisch blijven wijzen naar datzelfde created target. Voor nieuwe sections retourneert de planner nu naast `themeContext` ook een `sectionBlueprint` met category, qualityTarget, generationMode, required reads, relevante helpers, risky inherited classes, safe unit strategy, forbidden patterns, preflight checks en write-strategy hints. Exacte screenshot/design-replica prompts krijgen extra precision-first guardrails: liever één sterke create-write en daarna hooguit een volledige rewrite-edit, niet een baseline gevolgd door grote patch-batches.
- **`read-theme-file`**: Read one exact file from a Shopify theme. Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je read-context overeenkomt met plan-theme-edit en je write-call. Alleen voor backwards compatibility valt deze read-tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Lees dit liefst na plan-theme-edit, en alleen de compacte exact keys die de planner voorstelt. Voor native product-block flows hoef je templates/*.json na plan-theme-edit meestal niet opnieuw te lezen tenzij placement van het block expliciet gevraagd is. Handige reads zijn bijvoorbeeld sections/main-product.liquid, snippets/product-info.liquid of templates/product.json.
- **`read-theme-files`**: Read EXACT files from a Shopify theme. GEEN GLOBBING. Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je read-context overeenkomt met plan-theme-edit en je write-call. Alleen voor backwards compatibility valt deze read-tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Gebruik altijd search-theme-files als je niet 100% zeker bent van de file path. Gebruik dit bij voorkeur na plan-theme-edit, zodat je alleen de exact voorgestelde files leest. Wanneer een planner-read content nodig heeft en includeContent ontbreekt, zet deze tool dat nu automatisch op true met een warning.
- **`refund-order`**: Create a full or partial refund for an order using Shopify refundCreate.
- **`search-theme-files`**: Search scoped theme files and return compact snippets instead of full file dumps. Deze read-only tool valt voor backwards compatibility terug op main als themeId/themeRole ontbreekt, maar gebruik in elke editflow bij voorkeur hetzelfde expliciete target als in plan-theme-edit en je write-call. Gebruik dit eerst om een exacte, unieke patch-anchor of bestaand renderpad te vinden voordat je leest of schrijft. Voor native product-blocks of template placement gebruik je bij voorkeur eerst plan-theme-edit, en zoek je daarna alleen in de voorgestelde scope of exact keys. Bij compatibele clients mag een korte _tool_input_summary ook; die wordt dan als query gebruikt en de scope wordt waar mogelijk automatisch vernauwd. Legacy aliases zoals summary, prompt, request en tool_input_summary blijven alleen voor backwards compatibility ondersteund. Minimaal geldig voorbeeld: { query: 'buy_buttons', scope: ['sections', 'snippets'] }, { query: 'block.type', keys: ['sections/main-product.liquid', 'snippets/product-info.liquid'] } of { query: 'main-product', filePatterns: ['sections/*.liquid'] }.
- **`set-order-tracking`**: One-shot tracking update tool for LLMs: resolves order reference, updates fulfillment tracking, and returns verification-ready output.
- **`update-customer`**: Update a customer's information. Let op: acceptsMarketing wordt momenteel door Shopify genegeerd in deze mutation.
- **`update-fulfillment-tracking`**: Update order shipment tracking in the actual fulfillment record (not custom attributes/metafields). fulfillmentId is optional; when omitted, the latest non-cancelled fulfillment is updated automatically.
- **`update-order`**: Update an existing order with new information. Gebruik voor shipment tracking bij voorkeur set-order-tracking of update-fulfillment-tracking; gebruik deze tool niet als primaire tracking workflow.
- **`update-order-tracking`**: One-shot tracking update tool for LLMs: resolves order reference, updates fulfillment tracking, and returns verification-ready output.
- **`update-product`**: Update an existing product's fields (title, description, status, tags, etc.)
- **`verify-theme-files`**: Verify multiple theme files by expected metadata (size/checksumMd5). Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je verify-context overeenkomt met je planner/read/write-flow. Alleen voor backwards compatibility valt deze read-only tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Minimaal geldig voorbeeld: { expected: [{ key: 'sections/hero.liquid', checksumMd5: '...' }] }.
<!-- END: TOOLS_LIST -->

## Theme edit workflow
### Bestaande theme edit
- Flow: `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact` (mode="edit", patch object)
- Gebruik bij voorkeur `patch` voor één gerichte wijziging in een bestaand bestand en `patches` voor meerdere sequentiële wijzigingen in hetzelfde bestand. Dit bespaart drastisch token-verlies en voorkomt file truncations.
- Gebruik `patch-theme-file` bij voorkeur voor kleine single-file edits op bestaande snippets/sections wanneer de exacte file al bekend is. Dit houdt writes kleiner en voorspelbaarder.
- Gebruik alleen de `value` property bij edits als je het *volledige* bestand hebt ingelezen en heel de structuur drastisch verandert.
- Gebruik `mode="edit"` voor bestaande sections of settings.
- Start bij native product-blocks, theme blocks of template placement eerst met `plan-theme-edit` op hetzelfde expliciete theme. Gebruik daarna alleen de voorgestelde exact reads/writes.
- Voor een native block in een bestaande section patch je de bestaande `schema.blocks` en de render markup/snippet. Dit is normaal geen `blocks/*.liquid` workflow.
- Voor native product-blocks hoef je `templates/*.json` na `plan-theme-edit` meestal niet opnieuw te lezen; herlees dat template alleen als placement expliciet gevraagd is.
- Gebruik `create-theme-section` of `draft-theme-artifact mode="create"` alleen voor volledig nieuwe sections zonder bestaande inhoud.
- Zoek altijd eerst op zichtbare tekst of specifieke selectors met `search-theme-files`. Gebruik na `plan-theme-edit` bij voorkeur de exacte `nextReadKeys`, zodat je compact binnen section/snippet-bestanden zoekt. Dit geeft je direct de `searchString` voor je patch.
- Lees daarna met `get-theme-file` het exacte doelbestand in. `read-theme-file` is alleen een compat-alias voor clients die read-* naming gokken. Gebruik `get-theme-files` **ALLEEN** als je bewust meerdere exacte bestanden moet analyseren.

## Theme workflow
1. **De gebruiker bepaalt altijd op welk thema geschreven wordt.**
2. **Als de gebruiker geen thema opgeeft, VRAAG dit expliciet.** Gebruik nooit een stille default.
3. Gebruik `mode="edit"` voor wijzigingen aan bestaande bestanden (CSS fixes, spacing, kleuren, settings).
4. Gebruik voor nieuwe sections bij voorkeur `create-theme-section`; `draft-theme-artifact mode="create"` blijft de generieke advanced route (volledige inspectie: schema, presets, CSS kwaliteit).
5. Voor placement op homepage/producttemplate: maak eerst de section, en patch daarna alleen bij expliciete gebruikersvraag het juiste `templates/*.json` bestand op hetzelfde thema.
6. Gebruik `apply-theme-draft` alleen wanneer een eerder bestaand draft expliciet naar een ander theme gepromoot moet worden; dit is nooit de eerste write-tool voor een nieuwe section.
7. Gebruik `delete-theme-file` alleen na expliciete validatie van het target-bestand. themeRole/themeId is verplicht.
8. Verifieer writes direct via de `verify` output van `draft-theme-artifact` of aanvullend met `get-theme-file`, `get-theme-files` of `verify-theme-files`.
9. Om Railway te beschermen is er een harde limiet van maximaal 10 bestanden per theme-request.

## Shopify-conforme file policy

### mode="create" (nieuwe sections)
- Beperk writes tot `sections/<handle>.liquid`.
- Voeg alleen `snippets/` toe als markup of logica echt herhaald wordt.
- Voeg alleen `blocks/` files toe als je bewust theme blocks nodig hebt.
- Voeg alleen `locales/*.json` patches toe bij vaste, niet-merchant-editable UI strings.
- Templates/config zijn GEBLOKKEERD in create mode.
- Maak geen assets standaard; gebruik component-scoped CSS/JS in de section zelf.

### mode="edit" (bestaande bestanden wijzigen)
- Templates en config zijn TOEGESTAAN met automatische JSON validatie.
- Gebruik edit mode voor CSS fixes, spacing aanpassingen, kleurwijzigingen, en setting updates.
- `config/settings_data.json` wordt gevalideerd op het verplichte `current` object.
- `templates/*.json` wordt in edit mode JSON/JSONC-compatibel gevalideerd op verplichte `sections` en `order` structuur.

### Altijd geldig (beide modes)
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`.
- `richtext.default` moet Shopify-veilige HTML gebruiken: top-level `<p>` of `<ul>`, zonder niet-toegestane tags zoals `<mark>`.
- `layout/theme.liquid`: `content_for_header` en `content_for_layout` mogen nooit verdwijnen.

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
- LLM's mogen secties niet automatisch live plaatsen; de gebruiker bepaalt altijd het doelthema.
- Templates/config writes zijn alleen toegestaan in `mode="edit"` en worden automatisch gevalideerd op JSON structuur.
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
