# Codex MCP Audit - 2026-05-17

## A. Git / repo status

- Repository: `/Users/jordy/Desktop/MCP Shopify`
- Branch tijdens her-audit: `main`
- Upstream: `origin/main`
- Origin default branch: `main`
- Remote: `git@github.com:jordyhaasje/M-Cp.git`
- Startstatus her-audit: `main` was clean en gelijk met `origin/main`.
- Beslissing: **KEEP LOCAL + FIX FORWARD**. De eerdere LangFlow-artifacts blijven uit deze MCP-repo; alleen MCP-code, tests, docs en dit auditbestand zijn aangepast.
- Push/deploymentstatus wordt in het eindrapport vastgelegd nadat deze changeset is gepusht en Railway is gecontroleerd.

## B. MCP audit

Bron van waarheid: `apps/hazify-mcp-remote/src/tools/registry.js`.

Alle gevonden MCP tools:

`get-license-status`, `get-themes`, `plan-theme-edit`, `create-theme-section`, `search-theme-files`, `get-theme-file`, `get-theme-files`, `patch-theme-file`, `draft-theme-artifact`, `apply-theme-draft`, `verify-theme-files`, `delete-theme-file`, `get-products`, `get-product-by-id`, `get-customers`, `get-orders`, `get-order-by-id`, `update-order`, `update-fulfillment-tracking`, `set-order-tracking`, `get-supported-tracking-companies`, `get-customer-orders`, `update-customer`, `create-product`, `update-product`, `manage-product-variants`, `manage-product-options`, `delete-product`, `delete-product-variants`, `refund-order`, `clone-product-from-url`, `update-order-tracking`, `add-tracking-to-order`, `read-theme-file`, `read-theme-files`.

Algemene toolstatus:

- Product-, customer-, order-, refund- en trackingtools blijven geregistreerd en testbaar via registry/tenant/scope tests.
- Destructieve product/refund/order-opties blijven write-scope- en confirmation-gated.
- `update-fulfillment-tracking` is aangescherpt: het aanmaken van een fulfillment als fallback vereist nu expliciete confirmation en reason.
- `manage-product-options` is aangescherpt: `valuesToDelete` vereist nu expliciete confirmation en reason, en mutation audit wordt pas na succesvolle Shopify-response geschreven.

## C. Theme/code-tools

| Tool | Oorspronkelijke status | Vastgesteld probleem | Testmethode | Eindstatus |
| --- | --- | --- | --- | --- |
| `get-themes` | Werkend | Geen nieuw probleem gevonden | registry/tests | KEEP |
| `plan-theme-edit` | Functioneel, maar LangFlow-incompatibel schema | Publiek input schema exposeerde legacy `_tool_input_summary`; LangFlow sloeg toolmetadata over | MCP HTTP tools/list schema-test; no-leading-underscore schema assertion | FIXED |
| `create-theme-section` | Functioneel, maar LangFlow-incompatibel schema | Publiek schema exposeerde legacy `_tool_input_summary` | create/theme contract tests + MCP HTTP schema-test | FIXED |
| `search-theme-files` | Functioneel, maar LangFlow-incompatibel schema | Publiek schema exposeerde legacy `_tool_input_summary` | MCP HTTP schema-test; tool hardening tests | FIXED |
| `get-theme-file` / `read-theme-file` | Werkend | Geen nieuw probleem gevonden | batch/read tests + tenant isolation | KEEP |
| `get-theme-files` / `read-theme-files` | Werkend | Geen nieuw probleem gevonden | batch/read tests + tenant isolation | KEEP |
| `patch-theme-file` | Functioneel, maar LangFlow-incompatibel schema | Publiek schema exposeerde legacy `_tool_input_summary`; normalization kon legacy underscore laten lekken | tool hardening tests + MCP HTTP schema-test | FIXED |
| `draft-theme-artifact` | Functioneel, maar LangFlow-incompatibel schema | Publiek schema exposeerde legacy `_tool_input_summary` | 131 draft/apply tests + MCP HTTP schema-test | FIXED |
| `apply-theme-draft` | Niet agent-ready genoeg voor hoge-impact apply | Geen harde gate op `preview_applied`; geen target checksum-preconditions; geen apply audit | nieuwe apply tests, Shopify GraphQL validation | FIXED |
| `verify-theme-files` | Werkend | Geen nieuw probleem gevonden | batch verify tests | KEEP |
| `delete-theme-file` | Niet agent-ready genoeg voor destructieve delete | Geen checksum precondition, confirmKey, advisory lock, audit of verify-after-delete | nieuwe delete tests, Shopify GraphQL validation | FIXED |

Conclusie theme/code-tools: geen theme/code-tool is verwijderd of disabled. De eerder twijfelachtige tools zijn gefixt en kunnen na deployment opnieuw in LangFlow worden ingeschakeld, met de bestaande write-scope en confirmation guards.

## D. Code- en configwijzigingen

Aangepaste bestanden:

- `apps/hazify-mcp-remote/src/tools/planThemeEdit.js`
- `apps/hazify-mcp-remote/src/tools/createThemeSection.js`
- `apps/hazify-mcp-remote/src/tools/searchThemeFiles.js`
- `apps/hazify-mcp-remote/src/tools/patchThemeFile.js`
- `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
- `apps/hazify-mcp-remote/src/tools/applyThemeDraft.js`
- `apps/hazify-mcp-remote/src/tools/deleteThemeFile.js`
- `apps/hazify-mcp-remote/src/tools/manageProductOptions.js`
- `apps/hazify-mcp-remote/src/tools/updateFulfillmentTracking.js`
- `apps/hazify-mcp-remote/src/tools/registry.js`
- `apps/hazify-mcp-remote/src/lib/themeFiles.js`
- `apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `apps/hazify-mcp-remote/tests/mcpHttpAuth.test.mjs`
- `apps/hazify-mcp-remote/tests/themeFilesBatch.test.mjs`
- `AGENTS.md`
- `docs/02-SYSTEM-FLOW.md`
- `docs/03-THEME-SECTION-GENERATION.md`
- `codex_mcp_audit.md`

Belangrijkste wijzigingen:

- Publieke MCP input schemas exposeeren geen properties meer die met `_` beginnen. Legacy `_tool_input_summary` blijft intern geaccepteerd via compatibility preprocessing, maar LangFlow krijgt alleen het publieke `tool_input_summary`.
- `delete-theme-file` vereist nu een exacte target, `confirmKey`, checksum-precondition en verify-after-delete; delete gebruikt GraphQL `themeFilesDelete` met REST fallback, advisory lock en audit log.
- `apply-theme-draft` vereist nu `preview_applied` drafts en verse `expectedTargetFiles` preconditions voordat een target theme wordt overschreven; succesvolle apply wordt geaudit.
- `update-fulfillment-tracking` maakt geen fulfillment meer stilzwijgend aan; die fallback vereist expliciete bevestiging en reden.
- `manage-product-options` behandelt option-value deletion als destructieve route met confirmation en audit-after-success.

## E. Shopify Dev MCP / Shopify AI toolkit bewijs

- Shopify Dev MCP `learn_shopify_api(api="liquid")` gebruikt voor theme/Liquid criteria.
- Shopify Dev MCP `validate_theme` op `sections/dream-12-live-carousel.liquid`: **VALID**.
- Shopify Dev MCP `validate_graphql_codeblocks` voor `ThemeFilesDelete` en `ThemeFilesUpsert`: **VALID**.
- Lokale tests dekken Shopify theme constraints zoals schema JSON, range/select defaults, richtext defaults, block attributes, blank-safe media, scoped CSS, edit/create mode, template/config writes en verify-after-write.

## F. Testbewijs

- Gerichte regressiesuite:
  - `node --test apps/hazify-mcp-remote/tests/themeFilesBatch.test.mjs apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs apps/hazify-mcp-remote/tests/toolHardening.test.mjs apps/hazify-mcp-remote/tests/mcpHttpAuth.test.mjs apps/hazify-mcp-remote/tests/remediation.test.mjs apps/hazify-mcp-remote/tests/toolRegistry.test.mjs apps/hazify-mcp-remote/tests/tenantIsolationAllTools.test.mjs`
  - Resultaat: **137 passed, 0 failed**.
- Workspace MCP-suite:
  - `npm test --workspace @hazify/mcp-remote`
  - Resultaat: **passed**.
- Release-preflight:
  - `npm run release:preflight`
  - Resultaat: **passed**.

## G. Gmail MCP en LangFlow

- Gmail MCP is geen onderdeel van deze repository en wordt niet als artifact in deze repo opgeslagen.
- LangFlow flow/config hoort los van deze MCP-repo. De flow moet na deployment de live Hazify MCP opnieuw introspecteren zodat alle 35 tools inclusief de gefixte theme/code-tools beschikbaar zijn.
- Flow-correctie wordt buiten deze repo uitgevoerd en in het eindrapport vastgelegd.

## H. Resterende risico's

- Live Shopify writes blijven afhankelijk van geldige Shopify scopes, inclusief theme write access/exemption.
- `apply-theme-draft`, `delete-theme-file`, refunds en product-delete zijn bewust hoog-impact en blijven alleen bruikbaar met expliciete target/precondition/confirmation guards.
- De flow moet na Railway deployment opnieuw toolmetadata ophalen; zonder herstart/refresh kan LangFlow oude MCP metadata cachen.
