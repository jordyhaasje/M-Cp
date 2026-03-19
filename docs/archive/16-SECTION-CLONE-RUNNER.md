# Section Clone Runner (Feitelijke Repo-Scope)

## Doel
Deze repository implementeert geen lokale section-runner pipeline en geen section-compiler.
De remote Hazify MCP is de Shopify data-plane voor theme files en tooling discovery.

## Wat de remote Hazify MCP wel doet
1. Externe tooling discovery:
   - `list_theme_import_tools`
2. Theme file data-plane:
   - single-file: `get-theme-file`, `upsert-theme-file`, `delete-theme-file`
   - batch: `get-theme-files`, `upsert-theme-files`, `verify-theme-files`
3. Verificatie na write:
   - via `verify-theme-files`, of
   - inline via `verifyAfterWrite=true` bij `upsert-theme-files`

## Wat de remote Hazify MCP niet doet
- Geen browser automation
- Geen section-generatie
- Geen section-import

## Externe workflow
`AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`

Lokale tools (bijv. Chrome MCP, Shopify Dev MCP) verzorgen extractie/review/import.
Hazify remote schrijft en verifieert alleen de voorbereide bestanden op het target theme.
