# Hazify MCP Remote
Doelgroep: developers en coding agents.

Remote Shopify MCP service op `/mcp` voor store-operaties via Shopify APIs.

Runtime: Node.js `>=22.12.0`.

## Scope
- Wel: producten, klanten, orders, tracking, refunds en theme file CRUD.
- Wel: gevalideerde theme editing pipeline via `create-theme-section`, `draft-theme-artifact`, `apply-theme-draft`, `get-theme-file(s)` / `read-theme-file(s)` en `verify-theme-files`.
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

## Theme edit flow
- Canonical agent flow: `get-themes` -> `plan-theme-edit` -> compacte read/preflight -> `create-theme-section` voor nieuwe sections -> optioneel aparte `mode="edit"` of `patch-theme-file` voor vervolgfixes.
- `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact` blijft de standaardflow voor bestaande single-file theme edits.
- `read-theme-file` en `read-theme-files` zijn veilige compat-aliassen van `get-theme-file(s)` voor clients die read-* toolnamen gokken.
- Start voor native product-blocks, theme blocks en template placement eerst met `plan-theme-edit` op hetzelfde expliciet gekozen theme. Die planner houdt de read-scope klein en voorkomt one-file writes op themes waar de renderflow via snippets loopt.
- Na `plan-theme-edit` gebruik je bij voorkeur `search-theme-files` met de exacte `keys` uit `nextReadKeys` om eerst compacte snippets te vinden, in plaats van meteen volledige template/section reads te doen.
- `plan-theme-edit` accepteert langere `query`/`description` prompts, maar compacteert die intern naar een korte planner-query zodat rijke clients niet meer op de 240-char grens stuklopen.
- Voor `new_section` retourneert `plan-theme-edit` nu ook compacte `themeContext`-guardrails uit een content-achtige referentiesection in het doeltheme. Daardoor kan een LLM vóór het genereren al zien welke spacing-settings, wrapper-classes en schaalconventies het theme gebruikt.
- Compat-input voor wrappers/LLM-clients mag `_tool_input_summary` gebruiken voor veilige inferentie van theme target, intent/template en exact één bestaand file path. Die summary vervangt nooit echte write-inhoud. Legacy aliases zoals `summary`, `prompt`, `request` en `tool_input_summary` blijven alleen voor backwards compatibility ondersteund.
- Gebruik `get-theme-file` om na search alleen het exacte doelbestand volledig in te lezen
- Gebruik bij voorkeur `patch` voor één gerichte wijziging of `patches` voor meerdere sequentiële wijzigingen in hetzelfde bestand om token-verbruik te beperken en truncation te voorkomen
- Gebruik `patch-theme-file` voor kleine, bestaande single-file edits wanneer je het exacte targetbestand al weet. Top-level `key + searchString + replaceString` wordt compatibel naar `patch` genormaliseerd.
- `create-theme-section` is de primaire eerste write-tool voor een nieuwe `sections/<handle>.liquid`. De tool accepteert `handle` of `key` plus volledige section-Liquid, en wijst foutief `apply-theme-draft` gebruik terug naar de create-flow.
- `create-theme-section` leidt intern nogmaals compacte theme-context af en laat de guarded pipeline hero-achtige oversizing van typography, spacing, gaps en min-heights afvangen voordat een preview-write plaatsvindt.
- `draft-theme-artifact` valideert, lint en pusht naar het expliciet gekozen target theme. Bevat automatische JSON/JSONC-structuur validatie voor templates/config, blokkeert schema-only section stubs in create-mode en valideert Shopify-range regels (bounds, step-alignment, <3 discrete waarden => select-advies, Hazify preflight-guard max 101 stappen) voordat Shopify de write afwijst. Bij range-defaults die niet op de step-grid liggen geeft de tool nu ook exacte `suggestedReplacement.default` en geldige default-candidates terug.
- `draft-theme-artifact` geeft bij Shopify richtext-default fouten nu expliciete repair-codes terug zoals `richtext_default_forbidden_tag`, en bij een te minimale premium standalone section `standalone_section_too_minimal`.
- Gebruik in `richtext.default` alleen Shopify-veilige HTML: top-level `<p>` of `<ul>` en geen tags zoals `<mark>`.
- `draft-theme-artifact` ondersteunt voor single-file requests ook top-level `key + value`, `key + content`, `key + liquid` of `key + searchString + replaceString`, en valideert nieuwe `blocks/*.liquid` files nu ook op block-basisregels.
- Lokale create-validatie bundelt meerdere deterministische fouten in één response met machine-readable velden zoals `errorCode`, `errors[]`, `lintIssues[]`, `normalizedArgs`, `nextAction`, `retryMode`, `suggestedSchemaRewrites` en `preferSelectFor`. Operationele blockers zoals patch-anchor fouten, mixed create/edit zonder mode en preview write failures blijven fail-fast. Als zowel schema/style-inspectie als `theme-check` stuk zijn, komen die nu samen terug in dezelfde lokale preflight-response.
- `apply-theme-draft` promoveert een eerder goedgekeurde draft alleen naar een expliciet target; er is geen write-default naar live en deze tool is niet bedoeld als eerste write van een nieuwe section
- `verify-theme-files` en `get-theme-file(s)` helpen bij verificatie en readback
- Gebruik in nieuwe sections `video` voor merchant-uploaded video bestanden; `video_url` is alleen voor externe YouTube/Vimeo bronnen
- Gebruik `color_scheme` alleen wanneer het doeltheme al globale color schemes heeft in `config/settings_schema.json` en `config/settings_data.json`
- Voor een native block in een bestaande productsection gebruik je `mode="edit"` op de bestaande section/snippet; dit is normaal geen `blocks/*.liquid` workflow
- Voor native product-blocks hoef je `templates/*.json` na `plan-theme-edit` meestal niet opnieuw in te lezen; doe dat alleen als placement van het block expliciet gevraagd is.
- Voor placement op homepage/producttemplate geldt: maak eerst de section, en patch daarna alleen bij expliciete gebruikersvraag het bijbehorende `templates/*.json` bestand op hetzelfde gekozen theme

## Shopify-conforme file policy
- Beperk writes tot de noodzakelijke theme-bestanden; voor section-wijzigingen is dat meestal `sections/<handle>.liquid`
- Gebruik snippets/blocks/locales alleen als daar een concrete reden voor is
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`
- Geen blinde automatische template/config writes; placement via `templates/*.json` mag alleen als de gebruiker dat expliciet vraagt en het doeltheme expliciet is gekozen

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```
