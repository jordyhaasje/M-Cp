# MCP Remote Audit
Doelgroep: maintainers, developers en coding agents.

Status: levende audit en bron van waarheid voor de actuele MCP-toolingstatus.
Versie: 2026-04-22.
Laatst geverifieerd: 2026-04-22.

Deze audit is bewust compact gehouden. Onderstaande statusregels zijn de actieve samenvatting; de detailsecties blijven beschikbaar als achtergrond en moeten altijd aansluiten op code of recente productieobservatie.

## Compacte status
- Groen: de theme/section-pipeline (`plan-theme-edit`, `create-theme-section`, `patch-theme-file`, `draft-theme-artifact`) is gehard met planner-memory, verplichte reads, lokale preflight en verify-after-write.
- Groen: screenshot-only fallback, schema-preflight en refinement-recovery zijn bruikbaar voor normale stateless clients.
- Groen: screenshot-driven exact replicas bewaren nu ook langere plannerbriefing buiten de compacte `query`, zodat desktop/mobile-, screenshot- en exact-match-signalen niet meer verloren gaan in `description`- of summary-rijke prompts.
- Groen: de cross-theme acceptatiematrix dekt nu vier 2.0-theme archetypes voor prompt-only create, screenshot-only exact create, image-backed exact create, existing edit, template placement en native-block write/preview flows.
- Groen: `draft-theme-artifact mode="edit"` ondersteunt nu zowel `templates/*.json` als `templates/*.liquid`; JSON templates blijven JSON-valideren en Liquid templates krijgen Liquid safety-inspectie.
- Groen: `plan-theme-edit` geeft native-block architectuur nu ook door via `plannerHandoff`, en `draft-theme-artifact` valideert native-block snippets nu tegen gerelateerde section-schema’s, blank-safe optionele resources en `@theme` block-routes, zonder Shopify-onjuiste `name`-eisen op `@app`/`@theme` schema entries af te dwingen.
- Groen: MCP domeinfouten komen nu protocolcorrect terug als `isError: true`, en read/search/verify vereisen nu een expliciet of sticky bevestigd theme target.
- Groen: non-theme contract cleanup is aangescherpt voor refunds, product-contracten, tracking-redirects, destructieve auditsporen en eerste productimports.
- Groen: de license-service herkent Railway-productie nu expliciet, valideert verplichte productie-envs hard en beschermt backup-export/smoke checks beter zonder startup op Railway te blokkeren wanneer backup-export bewust niet is geconfigureerd.
- Groen: live Railway parity is bevestigd via Railway deploy/logreview en `npm run release:postdeploy` op 2026-04-22.
- Geel: docs-drift is afgebakend; auto-sync geldt alleen voor `AGENTS.md` en `docs/02-SYSTEM-FLOW.md`.

## Verificatie- en release-ledger
| Service | Laatst lokaal geverifieerd | Laatste lokale bewijsset | Laatst live op Railway | Live parity bevestigd |
| --- | --- | --- | --- | --- |
| `Hazify-MCP-Remote` | 2026-04-22 | `npm run check:docs`, `npm run check:repo`, `npm run build`, `npm run --workspace @hazify/mcp-remote test`, plus gerichte matrix/regressies voor `crossThemeAcceptanceMatrix`, de nieuwe exact-match review-wall heuristieken en Liquid template placement | `4c680bc9-7a23-45a3-bbc0-d3d349eb73fe` op 2026-04-22 | Ja. Railway deploy is succesvol, build/runtime logs tonen een normale startup, en `npm run release:postdeploy` is groen. |
| `Hazify-License-Service` | 2026-04-22 | `npm run --workspace @hazify/license-service test` en repo-brede build/checks | `b9c84b4e-9aa5-48dc-973b-f1c157b00146` op 2026-04-22 | Ja. De crash op `81578f9a-b774-4126-90f1-1eb12f9ac0b2` is opgelost; de nieuwe Railway deploy start correct en `npm run release:postdeploy` is groen. |

Releasewaarheid:
- Lokaal groen betekent alleen dat de code en tests in deze repo op 2026-04-22 kloppen.
- Live groen betekent pas iets nadat de relevante service is gepusht, gedeployed op Railway, gesmoked via `npm run smoke:prod` en gecontroleerd in Railway logs.
- Op 2026-04-22 voldoet de huidige live stand daaraan voor beide services. De smoke bevatte live 200's op `/health`, `/v1/session/bootstrap` en de MCP well-known endpoints; `/v1/admin/readiness` en `/v1/billing/readiness` zijn in die run eerlijk als optioneel overgeslagen gemeld omdat de benodigde lokale keys/envs niet waren gezet.
- `npm run check:git-sync` blijft een git-parity check; dit bewijst geen Railway deploy parity.

De detailsecties hieronder zijn achtergrondcontext. Voor actuele status, blockers en de actieve leesvolgorde zijn de compacte status en de canonieke vervolgdocs leidend.

## Externe waarheid
Deze audit is expliciet getoetst aan externe documentatie:

- Shopify Liquid docs bevestigen dat Liquid niet wordt gerenderd binnen `{% stylesheet %}` en `{% javascript %}`.
  Bron: <https://shopify.dev/docs/api/liquid/tags/stylesheet>, <https://shopify.dev/docs/api/liquid/tags/javascript>
- Shopify Liquid docs bevestigen dat `block.shopify_attributes` editor-data-attributen levert en buiten de theme editor geen waarde teruggeeft.
  Bron: <https://shopify.dev/docs/api/liquid/objects/block>
- Shopify theme docs bevestigen dat snippets via `render` named parameters ontvangen, buiten de theme editor blijven, en dat LiquidDoc parameter-validatie en toolfeedback toevoegt voor snippets en blocks.
  Bron: <https://shopify.dev/docs/storefronts/themes/architecture/snippets>, <https://shopify.dev/docs/storefronts/themes/tools/liquid-doc>
- Shopify theme docs bevestigen dat sections en theme blocks app/theme blocks ondersteunen via generieke schema entries zoals `{ "type": "@app" }` en `{ "type": "@theme" }`, plus `content_for 'blocks'` of `{% render block %}` voor rendering.
  Bron: <https://shopify.dev/docs/storefronts/themes/architecture/blocks/app-blocks>, <https://shopify.dev/docs/storefronts/themes/architecture/blocks>, <https://shopify.dev/docs/storefronts/themes/architecture/blocks/ai-generated-theme-blocks>
- Shopify Liquid docs bevestigen dat `section.id` dynamisch kan zijn voor JSON-template sections.
  Bron: <https://shopify.dev/docs/api/liquid/objects/section>
- Shopify Admin docs bevestigen dat alleen `ThemeRole.MAIN` uniek is.
  Bron: <https://shopify.dev/docs/api/admin-graphql/latest/enums/ThemeRole>
- Shopify Admin docs bevestigen dat `productCreate` alleen de initiële variant ondersteunt en dat extra varianten via `productVariantsBulkCreate` horen te lopen.
  Bron: <https://shopify.dev/docs/api/admin-graphql/latest/mutations/productVariantsBulkCreate>
- Shopify Admin docs bevestigen dat `refundCreate` in `2026-04` een verplichte `@idempotent` directive vereist.
  Bron: <https://shopify.dev/docs/api/admin-graphql/latest/mutations/refundCreate>
- Context7 voor de MCP TypeScript SDK bevestigt dat tool-level failures als `isError: true` moeten worden teruggegeven en dat output-schema-validatie dan wordt overgeslagen.
  Bron: `/modelcontextprotocol/typescript-sdk`, docs `server.md` en `client.md`

## Huidige hoofdconclusie
De remote MCP is nu het sterkst op de theme/section-stack. `plan-theme-edit`, `create-theme-section`, `patch-theme-file` en `draft-theme-artifact` vormen samen een serieus geharde pipeline met planner-memory, verplichte reads, lokale inspectie, linting en verify-after-write.

De grootste resterende risico’s zitten nu vooral in:
- audit- en docs-drift buiten de auto-gesynchroniseerde toolcatalogus
- niet-blokkerende Railway hygiene-signalen zoals `punycode` deprecation en `npm warn config production`

## Wat al aantoonbaar goed werkt
- De server is registry-first opgezet met centrale tooldefinities, outputschema’s en aliassen in `apps/hazify-mcp-remote/src/tools/registry.js`.
- De runtime doet centrale auth/scope-gating en hydrateert Shopify lazy in `apps/hazify-mcp-remote/src/index.js`.
- `plan-theme-edit` geeft bruikbare handoff-data terug, inclusief `plannerHandoff`, `nextReadKeys`, `writeTool` en `sectionBlueprint`.
- `plan-theme-edit` geeft voor native-block flows nu ook architectuur terug in `plannerHandoff`, zoals `primarySectionFile`, `usesThemeBlocks`, `snippetRendererKeys` en `hasBlockShopifyAttributes`.
- `create-theme-section` kan verplichte planner-reads zelf hydrateren en kan alleen in een smalle, bewezen vervolgsituatie create veilig omzetten naar edit.
- `patch-theme-file` is nu de feitelijke kleine existing-edit route voor exacte single-file fixes.
- `draft-theme-artifact` bevat sterke preflight-guardrails voor delimiterfouten, schema-validatie, range-defaults, step-alignment, presets, richtext defaults, `color_scheme`-compatibiliteit, parser-onveilige JS/Liquid-mixen en verify-after-write.
- De delimiter-preflight is nu ook embedded-code-safe: bare `}}` of `%}` uit inline CSS/JS, zoals keyframes of compacte animaties, veroorzaken niet langer vals-positieve `inspection_failed_liquid_delimiter_balance` fouten, terwijl echte ongesloten Liquid-openers in dezelfde blokken wel blijven falen.
- De planner behandelt constrained responsive edits op bestaande files nu strikter als patch-flow: prompts zoals “alleen op mobiel”, “desktop ongewijzigd” en “behoud bestaande animatie” sturen niet meer onnodig naar een rewrite.
- Exact-match review/trustpilot replica’s herkennen nu desktop/mobile references robuuster, spiegelen wrapper-signalen ook wanneer het doeltheme vooral via `section-properties` werkt, en markeren dubbele outer shells niet meer alleen voor comparison tables maar ook voor bounded review/card-composities.
- Theme-scale inspectie gebruikt nu naast losse maxima ook een composietdruk op font-size, padding, gaps en sticky compositie, zodat sections die “net overal iets te groot” zijn niet meer onterecht door de create-flow glippen.
- Decoratieve inline SVG-iconen zoals sterren en quote marks veroorzaken niet meer standaard een generieke `image_picker` warning; alleen echte image/video/resource-markup telt daar nu nog voor mee.
- `draft-theme-artifact` controleert native-block snippets nu ook tegen het gerelateerde section-schema: nieuwe block types en `block.settings.*` refs moeten echt bestaan, onveilige optionele block-media worden teruggestuurd, `@theme`/`content_for 'blocks'` routes vereisen een echt `blocks/*.liquid` bestand, en `@app`/`@theme` blocks in section-schema’s worden nu Shopify-conform niet meer onterecht op `name` afgekeurd.
- Screenshot- en reference-driven flows zijn inhoudelijk veel sterker dan eerder: de planner en validator begrijpen nu precision-first signalen zoals decoratieve anchors, media shells, responsive parity en screenshot-only fallbackstrategieën, en de suite bewijst nu ook volledige screenshot-only en image-backed create/writes over vier archetypes.
- De huidige lokale verificatie is groen: `npm run release:preflight` slaagt, `npm run --workspace @hazify/mcp-remote test` bevat nu ook de nieuwe native-block regressie rond `@app` schema-entries en de cross-theme acceptatiematrix bewijst nu native-block writes + preview-ready output over alle vier archetypes.
- Shopify Dev MCP `validate_theme` heeft daarnaast representatieve tijdelijke theme-fixtures groen gevalideerd voor zowel section/snippet exact-reference flows als native-block files (`sections/main-product.liquid`, `snippets/product-info.liquid`, `blocks/review-badge.liquid`).
- Tool-level domeinfouten worden nu als echte MCP tool errors teruggegeven: `apps/hazify-mcp-remote/src/index.js` leidt `isError` direct af van `success === false`, conform de MCP SDK-richtlijn.
- Theme reads/searches/verifies doen geen stille `main`-fallback meer; zonder expliciet of sticky bevestigd target komt nu een gedeelde `explicit_theme_target_required` repair response terug.
- `refund-order` gebruikt nu `refundCreate(input: $input) @idempotent(key: $idempotencyKey)` en genereert deterministische idempotency keys wanneer de client er geen meestuurt.
- `update-product` weigert de oude no-op velden `collectionsToJoin`, `collectionsToLeave` en `redirectNewHandle`.
- `update-order` schrijft geen tracking meer via `tracking`, `customAttributes` of `metafields`; de tool stuurt callers nu gestructureerd naar `set-order-tracking` of `update-fulfillment-tracking`.
- `get-order-by-id` houdt fulfillments als bron van waarheid en zet legacy tracking-signalen alleen nog in een expliciet gedepricieerde read-only substructuur.
- `delete-product` en `delete-product-variants` schrijven nu een persistente auditlog naar PostgreSQL en geven `auditLogId`, `requestId`, `tenantId`, `shopDomain` en target IDs terug.
- `clone-product-from-url` accepteert in eerste import-pass alleen nog `DRAFT` of `ARCHIVED`.
- Repo-brede verificatie op 2026-04-22 is groen: `npm run check:docs`, `npm run check:repo`, `npm run build`, `npm run --workspace @hazify/mcp-remote test`, `npm run --workspace @hazify/license-service test` en `npm run test:e2e`.

## Productiebewijs uit Railway
De laatste gecontroleerde productie-deploy van `Hazify-MCP-Remote` is `4c680bc9-7a23-45a3-bbc0-d3d349eb73fe` op 2026-04-22. Voor `Hazify-License-Service` is de laatste gecontroleerde success-deploy `b9c84b4e-9aa5-48dc-973b-f1c157b00146` op 2026-04-22.

De logs laten een realistisch beeld zien:
- de planner-, read- en write-pipeline wordt actief gebruikt op echte shops
- de validator blokkeert daadwerkelijk fouten zoals `inspection_failed_liquid_delimiter_balance`
- schemafouten zoals ongeldige range-defaults worden daadwerkelijk onderschept
- er komen nog echte parse- en schemafouten terug op section-creatie en op bestaande product-sections
- Railway bevestigde op 2026-04-22 ook een echte bestaande-section foutketen op `sections/hero-v1.liquid`: eerst `inspection_failed_truncated`, daarna `inspection_failed_liquid_delimiter_balance`. Dat incident is lokaal gereproduceerd en nu afgedekt met regressies voor mobile-only CSS-patches op bestaande sections met inline animatie-CSS.

Conclusie uit productie: de pipeline grijpt wel degelijk in en de huidige live Railway runtime sluit nu aan op de lokale remediation van 2026-04-22, inclusief de fix voor bestaande mobile-only section-edits met inline animatie-CSS, de bredere desktop/mobile exact-match heuristieken, de review-wall double-shell guard en de composiet theme-scale check. De eerdere license-service crash op ontbrekende `BACKUP_EXPORT_*` startup-validatie is opgeheven; backup-export blijft nu feature-gated op de admin-route in plaats van de hele service omver te trekken.

## Open blockers
- `[P1] Docs-drift wordt nog niet volledig automatisch tegengehouden.`
  `scripts/generate-tool-docs.mjs` synchroniseert alleen `AGENTS.md` en `docs/02-SYSTEM-FLOW.md`. `docs/03-THEME-SECTION-GENERATION.md`, `docs/04-MCP-REMOTE-AUDIT.md`, `docs/05-REMEDIATION-PLAN.md` en `apps/hazify-mcp-remote/README.md` blijven handmatig en daardoor driftgevoelig.

- `[P2] Context-TTL documentatie is niet helemaal scherp geformuleerd.`
  `HAZIFY_MCP_CONTEXT_TTL_MS` klinkt in de docs als een volledige request-context cache, terwijl de code nog steeds per request introspecteert en pas daarna de gehydrateerde context/client cachet.

- `[P3] Railway build/start hygiene heeft nog niet-blokkerende waarschuwingen.`
  De huidige live deploys starten goed, maar de logs tonen nog `npm warn config production Use --omit=dev instead` en de `punycode` deprecation warning. Dat is geen functionele blocker meer, wel een ops-hygiene track.

## Wat we nu nog niet eerlijk mogen claimen
We mogen nu nog niet claimen dat:

- elke MCP-client automatisch perfecte sections kan maken op elk Shopify 2.0 theme
- screenshot- of image-driven replica’s op elk willekeurig Shopify 2.0 theme universeel exact en zonder handmatige nabehandeling slagen
- alle non-theme tools volledig contractvast en audit-proof zijn

De reden is niet dat de pipeline zwak is, maar dat "perfect op elk theme" nog steeds een grotere claim is dan het huidige acceptatiebewijs. Live Railway parity is nu rond; verdere eerlijkheid zit vooral in docs-driftbeheersing en het scherp houden van de claimgrenzen.

## Wanneer we wél mogen claimen dat LLMs “perfecte sections” kunnen maken
Deze claim is pas verantwoord zodra alle onderstaande gates groen zijn:

1. `Protocol gate`
   Alle tool-level domeinfouten komen als `isError: true` terug, zodat ChatGPT, Claude en andere clients zichzelf correct kunnen herstellen.

2. `Theme target gate`
   Geen enkele theme read/search/verify/write doet nog een stille fallback naar live `main` als de gebruiker geen expliciet `themeId` of `themeRole` heeft opgegeven.

3. `Prompt-only section gate`
   Een gewone tekstprompt zonder referentiebeeld moet op meerdere theme-archetypes een volledige, merchant-editable section opleveren die `preview_ready` haalt zonder handmatige code-edit.

4. `Screenshot-only replica gate`
   Een prompt met alleen een referentiescreenshot moet een section kunnen genereren die compositie, hiërarchie, spacing, anchors en responsief gedrag trouw volgt, ook als er geen losse bron-assets zijn.

5. `Image-backed exact-match gate`
   Een prompt met duidelijke referentie-afbeeldingen of assets moet een precision-first write opleveren die visueel en structureel dicht genoeg bij de referentie zit om zonder handmatige codefix te previewen en inhoudelijk te accepteren.

6. `Existing-edit gate`
   Bestaande section- en snippet-edits moeten met `search -> exact read -> patch/write` op alle ondersteunde themes zonder truncatie- of anchor-drift werken.

7. `Native block gate`
   Product-page blocks in snippet-zware themes moeten met dezelfde betrouwbaarheid slagen als standalone sections.

8. `Placement gate`
   Expliciete placement in `templates/*.json` of `templates/*.liquid` moet alleen op verzoek gebeuren, syntactisch geldig blijven voor het betreffende template-type, en hetzelfde expliciete theme-target behouden.

9. `Merchant-editability gate`
   Nieuwe sections en blocks moeten niet alleen renderen, maar ook zinvolle settings, veilige defaults en correcte Theme Editor-interactie bieden.

10. `Cross-theme gate`
    De hele matrix moet bewezen zijn op minimaal deze archetypes:
    - een Dawn-achtig standaard 2.0 theme
    - een wrapper-zwaar premium theme
    - een snippet-zwaar producttheme
    - een theme met veel app blocks / editor-complexiteit

11. `Production gate`
    Railway-logs mogen na de fixes geen terugkerend patroon meer tonen van dezelfde parse-, schema- of target-fouten voor deze flows.

## Verplichte fixtracks
### 1. Protocolcorrectheid
Status: afgerond op 2026-04-22.
- Corrigeer `isError`-gedrag in `apps/hazify-mcp-remote/src/index.js`.
- Voeg regressietests toe die afdwingen dat domeinfouten via MCP-resultaten als fouten terugkomen, niet als succes.

### 2. Strikt theme-targeting
Status: afgerond op 2026-04-22.
- Verwijder de impliciete `main`-fallback uit read/search/verify-routes.
- Retourneer in plaats daarvan een gestructureerde repair response die de client dwingt eerst een theme te kiezen.
- Laat alleen expliciet meegegeven `themeRole="main"` of `themeId` toe.

### 3. Theme-validator pariteit
Status: afgerond lokaal op 2026-04-22.
- Trek snippet-inspectie richting section/block-inspectie.
- Voeg extra checks toe voor snippet-zware native block flows, Theme Editor-contracten, resource guards en precision-first fidelity-signalen.
- Maak van echte productiefouten uit Railway vaste regressietests.
- Native-block planning stuurt nu ook compacter: helper-snippets zonder `section.blocks`-renderer vallen uit de eerste read-pass, de planner geeft compacte search-anchors terug en de write-template is patch-first in plaats van full-rewrite-first.

### 4. Cross-theme acceptatiesuite
Status: afgerond lokaal op 2026-04-22.
- Bouw een vaste acceptatiematrix voor prompt-only, screenshot-only, image-backed exact-match, existing-edit, native-block en template-placement flows.
- Meet niet alleen `preview_ready`, maar ook inhoudelijke kwaliteit, merchant-editability en theme-target-correctheid.
- De native-block acceptance-route bewijst nu expliciet `plan-theme-edit -> search-theme-files -> draft-theme-artifact patches[]`, inclusief server-side auto-hydratie van planner-reads zonder verplichte full `get-theme-files` dump.

### 5. Non-theme contract cleanup
Status: afgerond op 2026-04-22.
- Maak `refund-order` conform de actuele Shopify GraphQL-shape met idempotency.
- Verwijder of implementeer de extra `update-product` velden echt.
- Bouw legacy tracking in `update-order` af of maak het expliciet opt-in met duidelijke deprecation-output.
- Maak audit-redenen bij destructieve product-acties duurzaam zichtbaar.
- Blokkeer `clone-product-from-url` op `ACTIVE` totdat mediaverificatie aantoonbaar klaar is.

### 6. Docs en waarheidshygiëne
- Maak dit document leidend voor open blockers en acceptatiecriteria.
- Behandel `docs/05-REMEDIATION-PLAN.md` als voortgangs- en release-log en niet als definitieve auditwaarheid.
- Trek `docs/03-THEME-SECTION-GENERATION.md`, `apps/hazify-mcp-remote/README.md` en gegenereerde tooldocs na elke gedragswijziging meteen gelijk.

## Minimale testuitbreidingen
De recente suite dekt nu:

- domeinfouten die `result.isError === true` moeten opleveren
- read/search/verify zonder expliciet of sticky theme-target
- een geldige `refundCreate @idempotent` mutation-shape
- het weigeren van oude `update-product` contractvelden
- het blokkeren van `ACTIVE` in `clone-product-from-url`
- persistente auditlogging voor destructieve productacties

Optionele extra bewijslaag:

- een authenticated production MCP smoke met een expliciete production token, bovenop de anonieme well-known en `/mcp` smoke die nu al groen is

## Werkwijze voor volgende fixes
Gebruik dit document als auditbron, en gebruik `docs/05-REMEDIATION-PLAN.md` voor voortgang, release-gates en live bevestiging.

De aanbevolen uitvoervolgorde is:
1. protocolcorrectheid
2. theme-target-strictness
3. snippet/native-block parity
4. cross-theme acceptance suite
5. non-theme contract cleanup
6. docs-sync en productie-observability

## Onderhoudsregel
Als code en deze audit elkaar tegenspreken, is de code leidend. Werk deze audit dan in dezelfde wijziging bij, zodat de repo één actuele bron van waarheid houdt.
