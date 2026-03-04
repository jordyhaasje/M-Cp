# Repo Structure

Dit document definieert de actieve mappen, archiefmappen en cleanup-regels voor deze workspace.

## Actieve mappen
- `docs/`: actieve operationele documentatie.
- `hazify-license-service/`: onboarding/dashboard + account/oauth/token service.
- `shopify-mcp-local/`: productie MCP servercode.
- `templates/mcp-server-template/`: startpunt voor nieuwe MCP servers.

## Archiefmappen
- `docs/archive/`: alleen legacy documentatie en oude connectorvoorbeelden.
- `archive/`: legacy data, oude testbestanden, en niet-actieve artifacts die niet meer in runtime worden gebruikt.

## Wat nooit in archief hoort
- Actieve servercode onder `hazify-license-service/src/` en `shopify-mcp-local/dist/`.
- Actieve configuratiebestanden zoals `package.json`, `.env.example`, en productiedocumentatie in `docs/`.

## Cleanup-regels
1. Verifieer eerst met `rg` dat een bestand niet meer wordt gerefereerd.
2. Verplaats daarna naar `archive/<datum>/...` met behoud van contextpad.
3. Werk `docs/90-REPO-CLEANUP-TRACKER.md` direct bij met wat is verplaatst.
4. Voer minimaal uit:
   - `node --check hazify-license-service/server.js`
   - `node --check shopify-mcp-local/dist/index.js`

## Dependencies beleid
- `node_modules/` blijft lokaal en wordt niet geversioneerd.
- Dependency-wijzigingen worden vastgelegd in `package.json` + `package-lock.json`.
- Alleen dependency-bestanden archiveren als ze aantoonbaar legacy zijn (bijv. oude lock snapshots), nooit actieve manifests.
