# Hazify Monorepo
Doelgroep: repo maintainers.

Deze repository bevat de productiecode voor:
- `apps/hazify-license-service` (accounts, onboarding, OAuth, token-introspectie + interne token-exchange, billing)
- `apps/hazify-mcp-remote` (remote MCP op `/mcp` voor Shopify store-operaties)

## Verantwoordelijkheid van deze MCP
- Interactie met Shopify stores via API-tools (producten, klanten, orders, tracking, refunds, theme files).
- Expose van MCP tools voor storebeheer.
- Remote deploy/verificatie van voorbereide theme files (`upsert-theme-files`, `get-theme-files`, `verify-theme-files`).
- Expose van metadata/advisering voor externe theme-import workflows.
- Diagnose van effectieve licentiestatus via `get-license-status`.

## Runtime gedrag (remote)
- Requests worden altijd gevalideerd via `/v1/mcp/token/introspect`.
- Shopify token exchange (`/v1/mcp/token/exchange`) is lazy:
  - niet bij `initialize` of `tools/list`
  - niet bij context-free tools
  - wel bij tools die Shopify-auth nodig hebben

## Niet de verantwoordelijkheid van deze MCP
- Genereren van Shopify theme sections.
- Importeren van gegenereerde sections in themes.
- Browser automation (Chrome/Playwright/headless tooling).

## Externe theme-workflow
`AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`

De remote Hazify MCP voert geen browserinspectie, section-generatie of section-import uit en levert metadata/advisering via `list_theme_import_tools`.

## Snel starten
```bash
npm ci
npm run build
npm test
```

## Runtime baseline
- Node.js `>=22.12.0` voor alle workspaces.

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

## Compat & migratie
- Nieuwe theme-planning tools: `resolve-homepage-sections`, `find-theme-section-by-name`, `search-theme-files`.
- Bestaande tracking-aliases `update-order-tracking` en `add-tracking-to-order` blijven backwards compatible en hergebruiken `set-order-tracking`.
- Remote MCP ondersteunt nu compat-first scopes: `mcp:tools`, `mcp:tools:read`, `mcp:tools:write`.
- `docs/16-SECTION-CLONE-RUNNER.md` is gearchiveerd; de actieve scope staat nu in `docs/12-REMOTE-MCP-SETUP.md` en `docs/14-GPT-INSTRUCTIONS.md`.
