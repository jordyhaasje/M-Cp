# Hazify MCP Remote
Doelgroep: developers en coding agents.

Remote Shopify MCP service op `/mcp` voor store-operaties via Shopify APIs.

Runtime: Node.js `>=22.12.0`.

## Scope
- Wel: producten, klanten, orders, tracking, refunds, theme file CRUD.
- Wel: guarded preview/apply flow via `draft-theme-artifact`, `apply-theme-draft`, `get-theme-file(s)` en `verify-theme-files`.
- Wel: reference-analyse via `analyze-reference-ui`, optioneel verrijkt door de visual worker.
- Wel: metadata/advisering voor externe review tooling via `list_theme_import_tools`.
- Niet: automatische JSON template placement of blind live section-import.
- Niet: browser automation binnen de hoofd-MCP runtime.

## Start (remote)
```bash
npm run --workspace @hazify/mcp-remote start:remote
```

## Start (stdio fallback)
```bash
npm run --workspace @hazify/mcp-remote start:fallback:stdio
```

## Security defaults
- Alleen `Authorization: Bearer` of `x-api-key`
- Query-token niet toegestaan
- Origin allowlist check op requests met `Origin` header
- OAuth metadata adverteert PKCE `S256`
- MCP session mode default: `stateless` (`MCP_SESSION_MODE=stateless`)
- `stateful` mode is opt-in (`MCP_SESSION_MODE=stateful`) en vereist sticky sessions of gedeelde session store
- `DATABASE_URL` is in productie vereist voor `theme_drafts` persistence en PostgreSQL advisory locks op theme writes
- Shopify credentials worden niet via introspection gedeeld; remote haalt per token een interne Shopify access token op via `/v1/mcp/token/exchange`

## Externe theme-workflow
`AI Client -> analyze-reference-ui -> draft-theme-artifact -> merchant review -> apply-theme-draft`

Deze service doet de guarded preview/apply flow en kan reference specs verrijken via een aparte visual worker.

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```
