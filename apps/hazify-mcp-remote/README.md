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
- Shopify credentials worden niet via introspection gedeeld; de remote haalt per token een interne Shopify access token op via `/v1/mcp/token/exchange`

## Theme edit flow
- `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`
- Gebruik deze flow voor bug fixes, CSS-wijzigingen, schema-aanpassingen en kleine gerichte uitbreidingen
- `draft-theme-artifact` valideert, lint en pusht standaard preview-first naar een development theme
- `apply-theme-draft` promoveert een eerder goedgekeurde draft naar een expliciet target
- `verify-theme-files` en `get-theme-file(s)` helpen bij verificatie en readback

## Shopify-conforme file policy
- Beperk writes tot de noodzakelijke theme-bestanden; voor section-wijzigingen is dat meestal `sections/<handle>.liquid`
- Gebruik snippets/blocks/locales alleen als daar een concrete reden voor is
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`
- Geen automatische template/config writes; merchants plaatsen sections zelf via de Theme Editor

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```
