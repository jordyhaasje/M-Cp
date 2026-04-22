# Hazify MCP Remote
Doelgroep: developers en coding agents.

Remote Shopify MCP service op `/mcp` voor store-operaties via Shopify APIs.

Runtime: Node.js `>=22.12.0`.

## Scope
- Wel: producten, klanten, orders, tracking, refunds en theme file CRUD.
- Wel: gevalideerde theme editing pipeline via `plan-theme-edit`, `search-theme-files`, `patch-theme-file`, `create-theme-section`, `draft-theme-artifact`, `apply-theme-draft`, `get-theme-file(s)` / `read-theme-file(s)` en `verify-theme-files`.
- Niet: automatische JSON template placement of blind live import.
- Niet: browser automation binnen de hoofd-MCP runtime.

## Start (remote)
```bash
npm run --workspace @hazify/mcp-remote start:remote
```

## Security defaults
- Alleen `Authorization: Bearer` of `x-api-key`
- Query-token niet toegestaan
- Origin allowlist check op requests met `Origin` header
- OAuth metadata adverteert PKCE `S256`
- MCP session mode default: `stateless` (`MCP_SESSION_MODE=stateless`)
- `stateful` mode is opt-in en vereist sticky sessions of gedeelde session store
- `DATABASE_URL` is vereist voor `theme_drafts` persistence en PostgreSQL advisory locks op theme writes
- **Truncation Protection**: In `mode="edit"` blokkeert de pipeline automatisch schrijfacties die leiden tot >50% bestandverkleining of verlies van kritieke JSON-velden
- **Linter Resilience**: `theme-check` fouten zoals MissingSnippet zijn gedegradeerd naar warnings om onnodige blokkades bij deel-edits te voorkomen
- Shopify credentials worden niet via introspection gedeeld; de remote haalt per token een interne Shopify access token op via `/v1/mcp/token/exchange`

## Operations & Observability
- Elke HTTP-response zet nu `X-Request-Id`; dezelfde `requestId` komt ook terug in de JSON logs van de remote MCP.
- Gebruik in Railway vooral deze events:
  - `mcp_http_tool_call_finished`: de tool-call was succesvol afgerond.
  - `mcp_http_tool_call_domain_failed`: de tool draaide wel, maar gaf een gestructureerde applicatie-fout terug zoals inspectie-, lint- of guarded write-failures. Deze events bevatten nu ook een compacte `failureSummary`.
  - `mcp_http_tool_call_failed`: echte runtime/protocol exceptions tijdens de tool-call.
- `failureSummary` is bewust compact en veilig: denk aan `primaryIssueCode`, `primaryPath`, `lintChecks`, `warningCount` en beperkte `failedKeys`, zonder file content of secrets te loggen.
- `npm run check:git-sync` bevestigt alleen lokale git parity tegen `origin/main`; het controleert niet welke Railway deploy live draait.
- Bevestig local-vs-remote parity daarom altijd apart via Railway deploy metadata/logs, zeker voordat je een fix als “live” beschouwt.

## Theme edit flow
- Canonical agent flow: gebruik `get-themes` alleen voor theme discovery wanneer de gebruiker nog geen expliciet `themeId` of `themeRole` heeft gegeven; daarna `plan-theme-edit` -> compacte read/preflight -> `create-theme-section` voor nieuwe sections -> optioneel aparte `mode="edit"` of `patch-theme-file` voor vervolgfixes.
- `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact` blijft de standaardflow voor bestaande single-file theme edits.
- `read-theme-file` en `read-theme-files` zijn veilige compat-aliassen van `get-theme-file(s)` voor clients die read-* toolnamen gokken.
- Start voor native product-blocks, theme blocks en template placement eerst met `plan-theme-edit` op hetzelfde expliciet gekozen theme. Die planner houdt de read-scope klein en voorkomt one-file writes op themes waar de renderflow via snippets loopt.
- `plan-theme-edit` geeft nu de onmiddellijke volgende stap terug via `nextTool` en `nextArgsTemplate`: meestal eerst `get-theme-file` of `get-theme-files`, en pas daarna de uiteindelijke write-tool via `writeTool` en `writeArgsTemplate`.
- Na `plan-theme-edit` gebruik je bij voorkeur `search-theme-files` met de exacte `keys` uit `nextReadKeys` om eerst compacte snippets te vinden, en daarna een exacte `get-theme-file(s)` read met `includeContent=true` voordat je schrijft.
- `plan-theme-edit` accepteert langere `query`/`description` prompts, maar compacteert die intern naar een korte planner-query zodat rijke clients niet meer op de 240-char grens stuklopen.
- Voor `new_section` retourneert `plan-theme-edit` nu naast compacte `themeContext`-guardrails ook een `sectionBlueprint` met section category (`static`, `interactive`, `media`, `commerce`, `hybrid`), exacte required reads, relevante helper snippets, risky inherited classes, safe unit strategy, forbidden patterns en write-strategy hints.
- Screenshot-only exacte replica's zonder losse bron-assets blijven `precision_first`, maar krijgen nu planner-signalen zoals `previewMediaPolicy="best_effort_demo_media"` en `allowStylizedPreviewFallbacks=true`. Daardoor mag de eerste write renderbare demo-media of een gestileerde media shell gebruiken zolang layout, styling en merchant settings trouw blijven aan de referentie. Expliciete bronmedia houden juist de strengere `strict_renderable_media` route actief.
- Exacte comparison/shell replica's krijgen nu ook planner-signalen voor desktop/mobile parity, decoratieve anchors zoals floating productmedia of badges/seals, en het vermijden van dubbele background-shells wanneer theme wrappers zoals `section-properties` al een outer surface impliceren.
- Exacte comparison/shell replica's krijgen nu ook planner-signalen voor rating-strips en comparison-iconografie, zodat sterren en check/x/thumb-iconen niet meer stilzwijgend mogen degraderen naar generieke blokjes, cirkels of lege vakken.
- Wanneer in dezelfde flow net een section is aangemaakt of exact is gepland, blijft dat bestand sticky voor vervolgprompts zoals `optimaliseer hem`, `maak V2` of `verbeter die section`, maar alleen zolang hetzelfde theme-target bewezen blijft. Een expliciete theme-switch verbreekt die sticky target-koppeling; alleen `themeRole='main'` mag nog veilig aan een eerder bevestigd `themeId` blijven hangen omdat Shopify daar maar één live theme tegelijk toestaat.
- Compat-input voor wrappers/LLM-clients mag `_tool_input_summary` gebruiken voor veilige inferentie van theme target, intent/template en exact één bestaand file path. Die summary vervangt nooit echte write-inhoud. Legacy aliases zoals `summary`, `prompt`, `request` en `tool_input_summary` blijven alleen voor backwards compatibility ondersteund.
- Gebruik `get-theme-file` om na search alleen het exacte doelbestand volledig in te lezen
- Gebruik bij voorkeur `patch` voor één gerichte wijziging of `patches` voor meerdere sequentiële wijzigingen in hetzelfde bestand om token-verbruik te beperken en truncation te voorkomen
- Gebruik `patch-theme-file` voor kleine, bestaande single-file edits wanneer je het exacte targetbestand al weet. Top-level `key + searchString + replaceString` wordt compatibel naar `patch` genormaliseerd, maar de tool vereist nu eerst een recente exacte read met `includeContent=true` en weigert niet-unieke anchors vroegtijdig.
- `create-theme-section` is de primaire eerste write-tool voor een nieuwe `sections/<handle>.liquid`. De tool accepteert `handle` of `key` plus volledige section-Liquid, blokkeert overschrijven van bestaande section-keys, geeft dan ook alternatieve nieuwe file keys terug zoals `-v2`, en retourneert nu ook een expliciete repair-sequence met `plan-theme-edit intent="existing_edit"` plus de juiste `draft-theme-artifact mode="edit"` full-rewrite template voor stateless clients. Als een gewone chatclient toch nog exact dezelfde net aangemaakte section via `create-theme-section` probeert te verfijnen, converteert de server dat nu alleen in die smalle bewezen vervolgflow veilig naar een edit-write. Buiten die bewezen vervolgflow blijft een bestaande key gewoon geblokkeerd.
- `create-theme-section` houdt exacte screenshot-replica's in de eerste write nu nog steeds op finale styling, maar blokkeert screenshot-only prompts zonder losse bronmedia niet meer automatisch op placeholder-strengheid zolang de preview renderbaar blijft via demo-media of een gestileerde media shell.
- `create-theme-section` leidt intern nogmaals compacte theme-context én section-blueprint metadata af, maar weigert nu ook writes zolang verplichte planner-reads nog niet met `includeContent=true` zijn gedaan. Daarna laat de guarded pipeline hero-achtige oversizing van typography, spacing, gaps en min-heights afvangen voordat een preview-write plaatsvindt.
- `draft-theme-artifact` valideert, lint en pusht naar het expliciet gekozen target theme. Bevat automatische JSON/JSONC-structuur validatie voor templates/config, blokkeert schema-only section stubs in create-mode en valideert Shopify-range regels (bounds, step-alignment, <3 discrete waarden => select-advies, Hazify preflight-guard max 101 stappen) voordat Shopify de write afwijst. Bij range-defaults die niet op de step-grid liggen geeft de tool nu ook exacte `suggestedReplacement.default` en geldige default-candidates terug.
- `draft-theme-artifact` doet nu ook vroegere lokale schema-required-field checks, zoals ontbrekende setting/block `label`, `type`, `id`, `name` en `content` waar relevant. Daardoor falen simpele Shopify-schemafouten eerder in compacte inspectie in plaats van pas later in `theme-check`.
- `draft-theme-artifact` stuurt exacte comparison/shell replica's nu ook terug wanneer ze onderscheidende referentie-anchors zoals floating productmedia of badges/seals laten vallen, wanneer ze rating-strips of comparison-iconografie degraderen naar generieke vormen, of wanneer ze een dubbele background-shell opbouwen via een eigen root background plus een theme wrapper-helper.
- `draft-theme-artifact` behandelt context-placeholders in bestaande full rewrites nu expliciet als foutklasse. Waarden zoals `REWRITE_ALREADY_APPLIED_IN_CONTEXT` worden niet meer als vage truncation geclassificeerd, maar geven een directe repair terug: stuur het volledige herschreven bestand of gebruik een letterlijke patch/patches.
- `draft-theme-artifact` geeft bij Shopify richtext-default fouten nu expliciete repair-codes terug zoals `richtext_default_forbidden_tag`, en bij een te minimale premium standalone section `standalone_section_too_minimal`.
- `draft-theme-artifact` voert voor interactieve sections nu extra parser-safety checks uit, zoals detectie van `${...{{ ... }}...}` conflicten, geneste `{{ ... }}` binnen dezelfde output-tag, en niet-gescopede JS selectors. Media-heavy sections krijgen extra guardrails voor image/video settings en responsieve rendering.
- Wanneer `plannerHandoff` aanwezig is, gebruikt `draft-theme-artifact` nu ook de planner-afgeleide `themeContext`, `sectionBlueprint` en native-block `architecture` als sessiegeheugen ontbreekt. Dat maakt stateless chatclients zoals ChatGPT/Claude/Perplexity betrouwbaarder in meerstaps section- en native-block flows.
- Native-block snippet-writes worden nu ook gevalideerd tegen het gerelateerde section-schema: nieuwe block types en `block.settings.*` refs moeten echt bestaan, optionele block-media moet blank-safe blijven, en `@theme`/`content_for 'blocks'` routes vereisen een echt `blocks/*.liquid` bestand.
- Voor editflows die net uit `plan-theme-edit` komen, verwacht `draft-theme-artifact` nu ook dat de planner-bestanden eerst echt zijn gelezen; daardoor blijven native block en multi-file edits dichter bij de echte section/snippet-architectuur van het theme.
- Gebruik in `richtext.default` alleen Shopify-veilige HTML: top-level `<p>` of `<ul>` en geen tags zoals `<mark>`.
- `draft-theme-artifact` ondersteunt voor single-file requests ook top-level `key + value`, `key + content`, `key + liquid` of `key + searchString + replaceString`, en valideert nieuwe `blocks/*.liquid` files nu ook op block-basisregels.
- `draft-theme-artifact mode="create"` blokkeert nu ook bestaande doelbestanden vroegtijdig en geeft dan machine-readable edit-hints plus alternatieve nieuwe keys terug in plaats van impliciet richting overwrite te gaan.
- `get-theme-files` exposeert nu ook compat-aliassen `role` en `filenames` in het publieke MCP schema. Missende batch-paths komen terug in `missingKeys` en tellen niet als geldige content-reads voor latere writes. `includeContent` wordt alleen automatisch naar `true` gezet wanneer de gevraagde `keys` exact overeenkomen met de planner-voorgeschreven `nextReadKeys` op een compatibel theme-target.
- Lokale create-validatie bundelt meerdere deterministische fouten in één response met machine-readable velden zoals `errorCode`, `errors[]`, `lintIssues[]`, `normalizedArgs`, `nextAction`, `retryMode`, `suggestedSchemaRewrites` en `preferSelectFor`. Operationele blockers zoals patch-anchor fouten, mixed create/edit zonder mode en preview write failures blijven fail-fast. Als zowel schema/style-inspectie als `theme-check` stuk zijn, komen die nu samen terug in dezelfde lokale preflight-response.
- `apply-theme-draft` promoveert een eerder goedgekeurde draft alleen naar een expliciet target; er is geen write-default naar live en deze tool is niet bedoeld als eerste write van een nieuwe section. De tool vereist ook expliciet `confirmation=\"APPLY_THEME_DRAFT\"` plus een `reason`.
- `verify-theme-files` en `get-theme-file(s)` helpen bij verificatie en readback
- Gebruik in nieuwe sections `video` voor merchant-uploaded video bestanden; `video_url` is alleen voor externe YouTube/Vimeo bronnen
- Gebruik `color_scheme` alleen wanneer het doeltheme al globale color schemes heeft in `config/settings_schema.json` en `config/settings_data.json`
- Voor een native block in een bestaande productsection gebruik je `mode="edit"` op de bestaande section/snippet; dit is normaal geen `blocks/*.liquid` workflow
- Voor native product-blocks hoef je `templates/*.json` na `plan-theme-edit` meestal niet opnieuw in te lezen; doe dat alleen als placement van het block expliciet gevraagd is.
- Voor placement op homepage/producttemplate geldt: maak eerst de section, en patch daarna alleen bij expliciete gebruikersvraag het bijbehorende `templates/*.json` bestand op hetzelfde gekozen theme

## Voorbeelden
- Screenshot replica: `plan-theme-edit intent="new_section"` -> lees `nextReadKeys` -> `create-theme-section`
- Screenshot-only replica zonder losse assets: zelfde flow, maar verwacht renderbare demo-media of een gestileerde media shell in plaats van onzichtbare placeholders
- Text-only section: zelfde flow, maar standaard `theme_consistent` in plaats van `exact_match`
- Bestaande section edit: `search-theme-files` -> `get-theme-file` -> `patch-theme-file` of `draft-theme-artifact mode="edit"`
- Bestaande section full rewrite: eerst `plan-theme-edit intent="existing_edit"` -> lees exacte `nextReadKeys` -> `draft-theme-artifact mode="edit"` met het volledige nieuwe bestand in `files[].value`
- Native product block: altijd eerst `plan-theme-edit intent="native_block"` zodat de planner de echte section/snippet-renderflow kan vinden
- Expliciete placement: maak eerst de section en patch pas daarna `templates/*.json`

Zie ook `docs/03-THEME-SECTION-GENERATION.md` voor archetype-notes, voorbeeldprompts en preview/live semantiek.

## Shopify-conforme file policy
- Beperk writes tot de noodzakelijke theme-bestanden; voor section-wijzigingen is dat meestal `sections/<handle>.liquid`
- Gebruik snippets/blocks/locales alleen als daar een concrete reden voor is
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`
- Geen blinde automatische template/config writes; placement via `templates/*.json` mag alleen als de gebruiker dat expliciet vraagt en het doeltheme expliciet is gekozen

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```

De lokale acceptatiematrix dekt nu ook native-block write/preview flows over vier Shopify 2.0 theme-archetypes, naast prompt-only create, screenshot-only exact create, image-backed exact create, existing edit en template placement.
