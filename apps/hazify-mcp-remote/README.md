# Hazify MCP Remote
Doelgroep: developers en coding agents.

Remote Shopify MCP service op `/mcp` voor store-operaties via Shopify APIs.

Runtime: Node.js `>=22.12.0`.

## Scope
- Wel: producten, klanten, orders, tracking, refunds en theme file CRUD.
- Wel: gevalideerde theme editing pipeline via `draft-theme-artifact`, `apply-theme-draft`, `get-theme-file(s)` en `verify-theme-files`.
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
- `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`
- Gebruik `get-theme-file` om na search alleen het exacte doelbestand volledig in te lezen
- Gebruik bij voorkeur `patch` voor één gerichte wijziging of `patches` voor meerdere sequentiële wijzigingen in hetzelfde bestand om token-verbruik te beperken en truncation te voorkomen
- Gebruik `patch-theme-file` voor kleine, bestaande single-file edits wanneer je het exacte targetbestand al weet
- `draft-theme-artifact` valideert, lint en pusht naar het expliciet gekozen target theme. Bevat automatische JSON-structuur validatie voor templates/config.
- `apply-theme-draft` promoveert een eerder goedgekeurde draft alleen naar een expliciet target; er is geen write-default naar live
- `verify-theme-files` en `get-theme-file(s)` helpen bij verificatie en readback
- Gebruik in nieuwe sections `video` voor merchant-uploaded video bestanden; `video_url` is alleen voor externe YouTube/Vimeo bronnen
- Gebruik `color_scheme` alleen wanneer het doeltheme al globale color schemes heeft in `config/settings_schema.json` en `config/settings_data.json`
- Voor een native block in een bestaande productsection gebruik je `mode="edit"` op de bestaande section/snippet; dit is normaal geen `blocks/*.liquid` workflow
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
