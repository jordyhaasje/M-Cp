# Hazify MCP Remote

Remote Shopify MCP service op `/mcp` voor store-operaties via Shopify APIs.

Runtime: Node.js `>=22.12.0`.

## Scope
- Wel: producten, klanten, orders, tracking, refunds, theme file CRUD.
- Wel: batch theme file deploy/verificatie via `upsert-theme-files`, `get-theme-files`, `verify-theme-files`.
- Wel: metadata/advisering voor externe theme-import tooling via `list_theme_import_tools` (zoals lokale Chrome MCP en Shopify Dev MCP).
- Niet: section generatie/import.
- Niet: browser automation (Chrome/Playwright/headless runtime).

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
- Shopify credentials worden niet via introspection gedeeld; remote haalt per token een interne Shopify access token op via `/v1/mcp/token/exchange`

## Externe theme-workflow
`AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`

Deze service voert geen browserinspectie, section-generatie of section-import uit.
De service doet wel remote deploy/verificatie van vooraf voorbereide theme files.

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```
