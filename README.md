# Hazify Monorepo

Deze repository bevat de productiecode voor:
- `apps/hazify-license-service` (accounts, onboarding, OAuth, token-introspectie, billing)
- `apps/hazify-mcp-remote` (remote MCP op `/mcp` voor Shopify store-operaties)

## Verantwoordelijkheid van deze MCP
- Interactie met Shopify stores via API-tools (producten, klanten, orders, tracking, refunds, theme files).
- Expose van MCP tools voor storebeheer.
- Expose van metadata-tooling voor externe theme-import workflows.

## Niet de verantwoordelijkheid van deze MCP
- Genereren van Shopify theme sections.
- Importeren van gegenereerde sections in themes.
- Browser automation (Chrome/Playwright/headless tooling).

## Externe theme-workflow
`AI Client -> Chrome MCP / Shopify Dev MCP -> Theme modifications`

De remote Hazify MCP voert die importflow niet uit en levert alleen discovery metadata via `list_theme_import_tools`.

## Snel starten
```bash
npm ci
npm run build
npm test
```

## Belangrijke checks
```bash
npm run check:docs
npm run check:repo
npm run build
npm test
```

## Productie endpoints
- License service: `https://hazify-license-service-production.up.railway.app`
- Remote MCP: `https://hazify-mcp-remote-production.up.railway.app/mcp`

## Leesvolgorde
Start met `docs/00-START-HERE.md`.
