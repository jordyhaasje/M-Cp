# Agent Runbook

## Startcheck
1. Lees verplicht in volgorde: `00` → `01` → `02` → `03` → `04` → `10` → `12`.
2. Controleer taakcontext in `AGENTS.md`.
3. Pas daarna code aan.

## Werkvolgorde
1. Impactscan met `rg`.
2. Code + docs in dezelfde wijziging.
3. Draai relevante checks.
4. Rapporteer wat is aangepast, waar, checks, en openstaande acties.

## Verplichte checks
- Root:
  - `npm run check:docs`
  - `npm run check:repo`
  - `npm run build`
  - `npm test`
- Voor release/deploy:
  - `npm run check:git-sync`
  - `npm run smoke:prod`
- Optioneel gericht:
  - `npm run --workspace @hazify/license-service test`
  - `npm run --workspace @hazify/mcp-remote test`
  - `HAZIFY_TEST_POSTGRES_URL=... npm run --workspace @hazify/license-service test` voor echte advisory-lock validatie (zonder deze env draait locktest als expliciete skip)

## Archivering
- Verplaats legacy alleen naar `docs/archive/`.
- Houd actieve runtimebestanden buiten archief.
