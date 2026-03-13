# Hazify MCP Remote

Remote Shopify MCP service op `/mcp` voor store-operaties via Shopify APIs.

## Scope
- Wel: producten, klanten, orders, tracking, refunds, theme file CRUD.
- Wel: metadata discovery voor externe theme-import tooling via `list_theme_import_tools`.
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

## Externe theme-workflow
`AI Client -> Chrome MCP / Shopify Dev MCP -> Theme modifications`

Deze service voert die workflow niet uit.

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```
