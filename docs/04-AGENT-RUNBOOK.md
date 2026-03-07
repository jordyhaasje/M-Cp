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

## Theme section flow (Chrome MCP + Remote Shopify MCP)
Gebruik voor section-cloning/import:
1. Inspecteer referentie met Chrome MCP (DOM/CSS/scripts).
2. Genereer section liquid met geldig `{% schema %}`.
3. Valideer via `validate-theme-section`.
4. Schrijf via `upsert-theme-section-pack`.
5. Injecteer in template via `inject-section-into-template` alleen als `targetTemplate` niet al in stap 4 zat.
6. Verifieer met `read-theme-files`.

Intent-regel:
- Bij section-opdrachten met URL/screenshot/DOM-context nooit `clone-product-from-url` gebruiken.
- `clone-product-from-url` is alleen voor productimport van een publieke productpagina.

Veiligheidsregel:
- Als `theme.role=MAIN` moet write expliciet bevestigd zijn met:
  - `liveWrite=true`
  - `confirm_live_write=true`
  - `confirmation_reason`
  - `change_summary`

## UI/asset regels
- Gebruik officiële merkassets uit `hazify-license-service/assets/brands/`.
- Houd iconografie consistent in maat, uitlijning en hover/focus states.
- Nieuwe assets eerst in root laten aanleveren is toegestaan; kopieer daarna naar de actieve assets-map.

## Archivering
- Niet-actieve bestanden verplaatsen naar `archive/`.
- Legacy documentatie verplaatsen naar `docs/archive/`.
- Nooit actieve runtimebestanden verplaatsen zonder referentiecheck.
