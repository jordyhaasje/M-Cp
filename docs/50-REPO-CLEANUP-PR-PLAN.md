# Repo Cleanup PR-plan

## Doel
Breng de repo terug naar een overzichtelijke, logische en onderhoudbare staat zonder de publieke MCP/OAuth-connectflow te breken.

## Niet-onderhandelbare guardrails
- De publieke remote MCP-route op `/mcp` blijft bruikbaar voor bestaande ChatGPT- en Perplexity-connecties.
- OAuth discovery en auth-routes blijven compatibel: `/.well-known/oauth-protected-resource`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`.
- Legacy OAuth aliases `/register`, `/authorize` en `/token` blijven bestaan totdat expliciet is bevestigd dat ze niet meer nodig zijn.
- Token-introspectie voor de remote MCP-service blijft bestaan.
- Productie-URL's, connectorvoorbeelden en onboardingflow worden niet gewijzigd zonder gelijktijdige docs-update en contractvalidatie.
- Elke cleanup-slice moet minimaal `npm run build` en `npm test` groen houden.

## Werkmethode
- Werk in kleine PR-slices.
- Elke slice heeft een duidelijke scope en non-goals.
- Runtime-wijzigingen aan MCP, OAuth, billing of Shopify-connectiviteit alleen met expliciete contractcheck.
- Documentatie en tracker worden in dezelfde wijziging bijgewerkt.

## PR-slices
### PR-0: Guardrails, plan en tracker
- Scope: cleanup-plan vastleggen, actieve tracker toevoegen, docs-index bijwerken, afgeronde trackers archiveren, evidente docs-ruis verwijderen.
- Non-goals: geen runtime- of API-gedrag wijzigen.
- Acceptatie:
  - Actieve plan- en trackerbestanden bestaan.
  - Leesvolgorde verwijst naar cleanupdocs.
  - MCP/OAuth-gebruikerspad blijft onaangeraakt.

### PR-1: Docs en repo-kaart rechttrekken
- Scope: `00`, `01`, `03`, `10`, `12` en `README` uitlijnen met de huidige code.
- Non-goals: geen functionele refactor.
- Acceptatie:
  - Actieve mappen kloppen.
  - Transportdocumentatie klopt met runtime.
  - License service docs noemen ook billing/admin-oppervlak.

### PR-2: Quality gates toevoegen
- Scope: CI aanscherpen met `npm ci`, docs/repo-hygiëne checks, daarna pas deeper unused-scan en theme-validatie waar haalbaar.
- Non-goals: nog geen grote codeverplaatsingen.
- Acceptatie:
  - Nieuwe docs- en repo-checks draaien in CI.
  - Falen duidelijk op doc-drift, junkbestanden of structurele repo-afwijkingen.
  - Deeper unused-scan en theme-validatie worden alleen toegevoegd zodra de huidige mirror- en theme-context daar stabiel genoeg voor zijn.

### PR-3: Shared package mirror-strategie verwijderen
- Scope: `apps/*/packages/*` als tracked mirrors uitfaseren en vervangen door een echte source-of-truth strategie.
- Non-goals: geen wijziging aan publieke MCP/OAuth-routes.
- Acceptatie:
  - Apps bouwen zonder app-local mirrors.
  - Lockfile wijst niet meer naar `apps/*/packages/*`.
  - `sync:shared` en `verify:shared` zijn verwijderd of vervangen.
- Uitvoering:
  - PR-3a: deploy-contract expliciet maken en valideren.
  - PR-3b: Railway services migreren naar repo-root.
  - PR-3c: mirrors uit git, scripts en lockfile verwijderen.
- Status:
  - Afgerond op 2026-03-10 na succesvolle Railway repo-root validatie in `cleanup-root-deploy` en daaropvolgende productie-migratie.

### PR-4: License service modulariseren
- Scope: `apps/hazify-license-service/src/server.js` opsplitsen in logische modules.
- Non-goals: geen endpointwijzigingen.
- Acceptatie:
  - Routecontracten blijven gelijk.
  - Tests blijven groen.
  - Monolith is opgesplitst in config/routes/services/storage/views.
- Uitvoering:
  - In slices, beginnend met pure config/domain/helpers zonder routewijzigingen.
  - Daarna OAuth-protocolhelpers, HTTP/cookie helpers, billing/readiness-services, account/domain-helpers, account/sessieservices en vervolgens de routeclusters `public-ui`, `dashboard`, `account`, `license-billing`, `admin` en `oauth`.
- Status:
  - Afgerond op 2026-03-10. `server.js` is teruggebracht tot het entrypoint, gedeelde helpers en route-registratie; OAuth draait nu via `src/routes/oauth.js` in plaats van een tweede in-file implementatie.
- Deploy-opmerking:
  - Deze workspace is nu direct gekoppeld aan het MCP Railway project. Voor de aparte `Hazify-License-Service` Railway projectdeploy is nog een eigen repo-root deploypad of serviceconfig nodig; tot die stap zijn license-service refactors lokaal en in tests gevalideerd, maar niet automatisch vanuit deze link uitgerold.

### PR-5: Theme file laag moderniseren
- Scope: theme file reads/writes migreren van REST Asset API naar Admin GraphQL theme file management met compatibele adapterlaag.
- Non-goals: nog geen volledige section-redesign.
- Acceptatie:
  - `get-theme-file`, `upsert-theme-file`, `delete-theme-file`, `get-themes` blijven werken.
  - Backward compatibility voor toolcontracten blijft behouden.
- Uitvoering:
  - Eerst GraphQL-primary voor theme list/read/write/delete.
  - Daarna checksum-gebaseerde conflictchecks ook via GraphQL uitvoeren, zodat REST alleen nog fallback is voor shops zonder ondersteunde theme GraphQL.
- Status:
  - Afgerond op 2026-03-10. `src/lib/themeFiles.js` gebruikt nu GraphQL-primary voor list/read/write/delete, inclusief conflict-safe checksum-writes; REST blijft alleen als compat-fallback voor unsupported shops.

### PR-6: Section-systeem vervangen
- Scope: huidige heuristische replicator vervangen door een constrained blueprint-generator met echte theme-rendervalidatie.
- Non-goals: geen generieke arbitrary webpage cloning meer beloven.
- Acceptatie:
  - Ondersteunde blueprint-catalogus is expliciet.
  - Validatie gebruikt echte theme-context.
  - Theme editor best practices zijn ingebouwd.
- Status:
  - Afgerond op 2026-03-10. De replicator gebruikt nu een expliciete blueprint-catalogus, inline `{% stylesheet %}` / `{% javascript %}`, editor lifecycle hooks (`shopify:section:load|unload`, `shopify:block:select`) en storefront theme-context renderchecks met rollback bij render-fail op main themes.

### PR-7: Legacy en archief definitief saneren
- Scope: resterende oude docs, ongebruikte voorbeelden, compat-shims en bevestigde legacy-paden verwijderen of archiveren.
- Non-goals: geen nieuwe featureontwikkeling.
- Acceptatie:
  - Repo bevat alleen actieve code, actieve docs en bewust bewaard archief.
  - Tracker kan worden afgesloten.
- Status:
  - Afgerond op 2026-03-10. De laatste `apps/hazify-license-service/server.js` compat-shim is verwijderd, tests importeren direct `src/server.js`, de repo-hygiënecheck blokkeert herintroductie van die shim en `docs/archive/README.md` beschrijft het bewaarde archief nu volledig.

## Volgorde
1. Eerst docs en guardrails.
2. Dan quality gates.
3. Dan package source-of-truth.
4. Pas daarna grote code-refactors.

## Beslisregels
- Als een cleanup-actie de connectflow voor ChatGPT/Perplexity kan raken, dan gaat die pas door na expliciete contractcheck.
- Als documentatie en code verschillen, dan wordt documentatie meteen meegetrokken.
- Als een bestand alleen historisch nut heeft en geen actieve route/documentatie meer ondersteunt, dan hoort het in `docs/archive/`.
