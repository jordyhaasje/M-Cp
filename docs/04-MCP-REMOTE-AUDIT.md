# MCP Remote Audit
Doelgroep: maintainers, reviewers en coding agents.

Deze audit is de compacte bron van waarheid voor de Hazify Remote MCP. Code blijft leidend; wanneer deze audit afwijkt van runtime-code of tests, moet de documentatie in dezelfde wijziging worden aangepast.

## Production Readiness Status
- Status op 2026-04-26: de eerder gemelde P1/P2 review findings zijn in code opgelost en lokaal gevalideerd.
- Authenticated MCP read-smoke is live groen: `initialize`, `tools/list` met 35 tools en `get-license-status` werken op productie met een geldige MCP credential.
- Laatste bevestigde productie-baseline op `main` voor deze opschoonbranch:
  - MCP Remote deployment ID: `aea4e656-b98b-4427-b833-a70e28c0e9e4`
  - License Service deployment ID: `94bb86f2-cb3a-4726-93e2-661b144f7d04`
- Railway runtime-start gebruikt direct Node via `railway.json` en `scripts/start-service.mjs`; de MCP start bouwt `dist/` direct uit `src/` en root `start:mcp`/`start:license` mogen niet terug naar geneste `npm run` starts.
- De runtime is multi-tenant: Shopify store-context komt uit de License Service token-exchange en wordt per request aan de MCP toolcontext gekoppeld.

## Externe Validatie
- Context7 is gebruikt voor actuele MCP TypeScript SDK-waarheid: Streamable HTTP gebruikt `initialize`, `tools/list`, `tools/call`, tool-level `isError` en Host-header bescherming tegen DNS rebinding.
- Shopify Dev MCP is gebruikt voor actuele Admin API-waarheid: Admin GraphQL gebruikt `X-Shopify-Access-Token`; theme writes lopen via `themeFilesUpsert`; Shopify vraagt naast `write_themes` ook theme file write access/exemption; fulfillment-order reads vereisen expliciete read fulfillment-order scopes.
- Railway MCP is gebruikt voor productie-observability: de actuele logs toonden geen nieuwe protocol- of toolcall-foutreeks; de overgebleven runtime-hygiene was de oude `npm warn config production` startwaarschuwing, opgelost door direct Node te starten.

## Wat De MCP Kan
- Shopify producten lezen, zoeken, aanmaken, wijzigen, verwijderen en varianten/options beheren.
- Shopify klanten en orders lezen en ordergegevens wijzigen binnen de toolcontracten.
- Tracking bijwerken via fulfillment tracking-tools en direct verifiëren via order readback.
- Refunds aanmaken met expliciete bevestiging en scope.
- Themes ontdekken, exact zoeken/lezen/verifiëren en guarded theme file writes uitvoeren.
- Nieuwe sections genereren via `plan-theme-edit` en `create-theme-section`.
- Bestaande sections/snippets/templates/config wijzigen via `search-theme-files`, `get-theme-file`, `patch-theme-file` en `draft-theme-artifact mode="edit"`.
- Eerder opgeslagen theme drafts expliciet promoveren via `apply-theme-draft`, met confirmation, reason, shop-binding en verify-after-write.
- Compat-aliassen ondersteunen voor clients die toolnamen gokken, zonder entitlements of security gates te omzeilen.

## Opgeloste Review Findings
- Onbekende MCP scopes falen dicht: alleen `mcp:tools`, `mcp:tools:read` en `mcp:tools:write` zijn geldig.
- Alias-tools erven canonieke entitlements: aliasnamen zoals tracking- en read-theme aliassen kunnen de license gate niet omzeilen.
- Theme drafts zijn shop-bound bij apply: een draft ID van shop A kan niet op shop B worden toegepast.
- Verify mismatch, missing of verify-errors blokkeren `preview_ready` en `applied`.
- Non-main theme roles vereisen `themeId`; alleen `themeRole="main"` mag role-only omdat Shopify maar een live main theme heeft.
- Fulfillment scopes bevatten zowel read als write fulfillment-order scopes voor trackinggedrag.
- OAuth resource/audience wordt aan de publieke `/mcp` resource gebonden.
- Custom-app onboarding stuurt primair op Admin API access token; app key/secret blijft alleen voor trusted app-achtige setups.
- Theme-write blokkades door ontbrekende Shopify theme file access/exemption worden als `theme_write_exemption_required` teruggegeven.

## Theme Tool Waarheid
- De gebruiker kiest altijd het doelthema. Zonder expliciete keuze moet de client om `themeId` of `themeRole="main"` vragen.
- Theme file writes vereisen Shopify theme file write access/exemption naast `write_themes`; ontbreekt die, dan is dat een onboarding/app-permission issue en geen retrybare Liquid-fout.
- Nieuwe sections: eerst plannen met `plan-theme-edit`; schrijven met `create-theme-section` of `draft-theme-artifact mode="create"`.
- Bestaande single-file edit: `search-theme-files` -> `get-theme-file` -> `patch-theme-file` of `draft-theme-artifact mode="edit"`.
- Native product-blocks, theme blocks en template placement starten met `plan-theme-edit`; schrijf daarna alleen de exact voorgestelde bestanden.
- `create-theme-section` is niet bedoeld om bestaande section-bestanden te wijzigen. Refinements op bestaande files horen via edit-mode of patch flow.
- Templates en config zijn alleen toegestaan in `mode="edit"` en krijgen JSON/JSONC-validatie.
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`.
- `layout/theme.liquid` mag `content_for_header` en `content_for_layout` nooit verliezen.
- Screenshot-only replica's zonder losse bronassets mogen renderbare demo-media of een gestileerde media shell gebruiken; expliciete bronmedia blijft strenger.

## Claimgrens
- De MCP kan ChatGPT, Claude en andere MCP-clients tools geven om store- en theme-taken gericht uit te voeren wanneer de client remote MCP met bearer token of API key ondersteunt.
- De MCP garandeert geen pixel-perfect theme output in één poging. De pipeline verhoogt betrouwbaarheid met planning, compact reads, linting, schema-validatie, verify-after-write en repair responses.
- Financiële en destructieve acties blijven confirmation-gated.
- Live plaatsing van sections in templates gebeurt alleen op expliciete gebruikersvraag en op hetzelfde gekozen theme.

## Actuele Open Punten
- Een echte read-only MCP smoke-token is nog nodig om live te bewijzen dat write-tools met alleen `mcp:tools:read` worden geweigerd. De code en tests borgen dit al; de productie-smoke vereist aparte credential-aanmaak.
- Na merge en Railway redeploy moeten deployment metadata, `npm run smoke:prod` en Railway logs bevestigen dat direct Node de oude `npm warn config production` runtime-startwaarschuwing heeft verwijderd.
- `@shopify/theme-check-node` kan upstream nog een `punycode` waarschuwing tonen wanneer de lint-route wordt geladen. Dat is geen startup- of toolcontractblocker; monitoren blijft genoeg zolang er geen tool failure ontstaat.

## Code Map
- MCP entry en auth gates: `apps/hazify-mcp-remote/src/index.js`
- Toolregistry en contracts: `apps/hazify-mcp-remote/src/tools/registry.js`
- Theme planning/writes: `apps/hazify-mcp-remote/src/tools/planThemeEdit.js`, `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`, `apps/hazify-mcp-remote/src/tools/createThemeSection.js`, `apps/hazify-mcp-remote/src/tools/applyThemeDraft.js`
- Theme resolving en read/write helpers: `apps/hazify-mcp-remote/src/lib/themeFiles.js`
- OAuth scope utilities: `packages/mcp-common/src/index.js` plus Railway mirrors
- Shopify required scopes: `packages/shopify-core/src/index.js` plus Railway mirrors
- License onboarding en token routes: `apps/hazify-license-service/src/server.js`, `apps/hazify-license-service/src/routes/*`
- Railway startup: `railway.json`, `scripts/start-service.mjs`

## Acceptatiecriteria
- `npm run check:docs`
- `npm run check:repo`
- `npm run release:preflight`
- `npm audit --omit=dev`
- `npm run smoke:prod` na deploy
- Railway deploy metadata en logs controleren voor beide services wanneer runtime of shared packages zijn geraakt.
