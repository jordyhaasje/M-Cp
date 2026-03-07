# Agent Runbook

Werkafspraken voor coding agents in deze workspace.

## Startcheck
1. Lees verplicht in volgorde: `00` → `01` → `02` → `03` → `04` → `10` → `12`.
2. Controleer daarna de taakcontext in `AGENTS.md`.
3. Pas pas daarna code aan.

## Werkvolgorde per wijziging
1. Maak een snelle impactscan met `rg`.
2. Wijzig code/documentatie in dezelfde wijziging.
3. Draai relevante checks.
4. Rapporteer:
   - wat is aangepast,
   - waar,
   - welke checks zijn uitgevoerd,
   - wat nog openstaat.

## Verplichte checks
- License service:
  - `node --check /Users/jordy/Desktop/Customer service/hazify-license-service/server.js`
- MCP service:
  - `node --check /Users/jordy/Desktop/Customer service/shopify-mcp-local/dist/index.js`
  - `npm test --prefix /Users/jordy/Desktop/Customer service/shopify-mcp-local`

## UI/asset regels
- Gebruik officiële merkassets uit `hazify-license-service/assets/brands/`.
- Houd iconografie consistent in maat, uitlijning en hover/focus states.
- Nieuwe assets eerst in root laten aanleveren is toegestaan; kopieer daarna naar de actieve assets-map.

## Archivering
- Niet-actieve bestanden verplaatsen naar `archive/`.
- Legacy documentatie verplaatsen naar `docs/archive/`.
- Nooit actieve runtimebestanden verplaatsen zonder referentiecheck.
