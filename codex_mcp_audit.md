# Codex MCP Audit - 2026-05-17

## A. Git / repo status

- Repository: `/Users/jordy/Desktop/MCP Shopify`
- Huidige branch tijdens audit: `main`
- Upstream: `origin/main`
- Default branch origin: `main`
- Remote: `git@github.com:jordyhaasje/M-Cp.git`
- Startstatus: lokaal was clean maar `main` liep 3 commits voor op `origin/main` en 0 commits achter.
- Lokale commits die nog niet op remote stonden:
  - `886e680` - `Fix prompt fidelity for generated theme sections`
  - `853d89d` - `Fix stale block contracts for media story sections`
  - `5cd16ac` - `Harden section schema and prompt validation`
- Remote `origin/main` stond op `621a2f2 docs: record live new-section validation`.
- Inhoudelijke conclusie: lokale commits zijn production-minded theme-tool hardening, maar een summary-only fallback in `create-theme-section` was te permissief.
- Beslissing: **MERGE BOTH / KEEP LOCAL WITH CLEANUP**. Lokale commits behouden, extra fix toegevoegd zodat vrije summary-tekst nooit code vervangt, en daarna gepusht naar `origin/main`.
- Gepushte fixcommit: `bdf7090` - `Harden theme section creation and add LangFlow audit`.
- Na push was `main` gelijk met `origin/main` (`0` ahead / `0` behind).

## B. MCP audit

Gevonden registry: `apps/hazify-mcp-remote/src/tools/registry.js`.

Alle gevonden MCP tools:

`get-license-status`, `get-themes`, `plan-theme-edit`, `create-theme-section`, `search-theme-files`, `get-theme-file`, `get-theme-files`, `patch-theme-file`, `draft-theme-artifact`, `apply-theme-draft`, `verify-theme-files`, `delete-theme-file`, `get-products`, `get-product-by-id`, `get-customers`, `get-orders`, `get-order-by-id`, `update-order`, `update-fulfillment-tracking`, `set-order-tracking`, `get-supported-tracking-companies`, `get-customer-orders`, `update-customer`, `create-product`, `update-product`, `manage-product-variants`, `manage-product-options`, `delete-product`, `delete-product-variants`, `refund-order`, `clone-product-from-url`, `update-order-tracking`, `add-tracking-to-order`, `read-theme-file`, `read-theme-files`.

Theme/code-tools:

| Tool | Oorspronkelijke status | Testmethode | Fix | Eindstatus |
| --- | --- | --- | --- | --- |
| `get-themes` | Werkend | Registry/tests + service coverage | Geen | KEEP |
| `plan-theme-edit` | Werkend | `themePlanning`, cross-theme acceptance | Geen | KEEP |
| `create-theme-section` | Verdacht door summary-only fallback | `createThemeSection.test.mjs`, direct targeted suite, full test runner | Fallback verwijderd; summary-only geeft nu `missing_section_liquid` | FIXED |
| `search-theme-files` | Werkend met caveat: pattern-search heeft geen REST fallback | Test suite + codepad inspectie | Geen | KEEP |
| `get-theme-file` / `read-theme-file` | Werkend | batch/read tests + registry alias | Geen | KEEP |
| `get-theme-files` / `read-theme-files` | Werkend | `themeFilesBatch.test.mjs` | Standalone test zet nu zelf `NODE_ENV=test` | FIXED |
| `patch-theme-file` | Werkend | tool hardening/cross-theme tests | Geen | KEEP |
| `draft-theme-artifact` | Werkend | 129 draft/apply tests, schema/codegen checks | Geen extra fix in deze audit | KEEP |
| `apply-theme-draft` | Werkend maar hoog-impact | apply tests | Niet in Agent allowlist | KEEP, agent disabled |
| `verify-theme-files` | Werkend | batch verify tests | Geen | KEEP |
| `delete-theme-file` | Destructief, confirmation-gated; geen verify-after-delete/advisory-lock hardening gevonden | codepad inspectie | Niet in Agent allowlist | KEEP, agent disabled |

Aanvullende verificatie:

- `node --test` gerichte theme-suite: 206/206 passed.
- `npm --prefix apps/hazify-mcp-remote test`: 51/51 testbestanden passed.
- Shopify Dev MCP `validate_theme` op fixture `dream-12-live-carousel.liquid`: passed.
- Lokale Shopify Liquid skill kon docs zoeken; lokale `validate.mjs` miste eigen skill-dependency `@shopify/theme-check-common`, daarom is Shopify Dev MCP validatie als bron gebruikt.

## C. Code- en configwijzigingen

Aangepaste/aangemaakte bestanden:

- `apps/hazify-mcp-remote/src/tools/createThemeSection.js`
  - Onveilige deterministic summary-only fallback verwijderd.
- `apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
  - Test aangepast: summary-only Dream prompt moet complete Liquid vragen in plaats van code te genereren.
  - Contract-conflict test geeft nu expliciet Liquid mee.
- `apps/hazify-mcp-remote/tests/themeFilesBatch.test.mjs`
  - Standalone test zet `NODE_ENV=test`.
- `scripts/langflow/hazify-local-mcp-bridge.sh`
  - Start lokale M-Cp HTTP server met Railway-env en exposeert hem als stdio bridge.
- `scripts/langflow/hazify-mcp-stdio-bridge.mjs`
  - Kleine secret-stille stdio -> HTTP JSON-RPC bridge voor Hazify MCP.
- `langflow/exports/hazify_shopify_agent_ollama_gmail_mcp.langflow.json`
  - Secret-vrije LangFlow export.
- `langflow/README.md`
  - Lokale flow/bridge documentatie.
- `codex_mcp_audit.md`
  - Dit auditrapport.

Tool-registratie in runtime is niet ingeperkt; de LangFlow Agent gebruikt tool metadata/statussen om hoog-impact tools uit te zetten.

## D. Gmail MCP

- Lokale server getest met `npx @gongrzhe/server-gmail-autoauth-mcp`.
- `tools/list` bevestigd:
  - `send_email`, `draft_email`, `read_email`, `search_emails`, `modify_email`, `delete_email`, `list_email_labels`, `batch_modify_emails`, `batch_delete_emails`, `create_label`, `update_label`, `delete_label`, `get_or_create_label`, `create_filter`, `list_filters`, `get_filter`, `delete_filter`, `create_filter_from_template`, `download_attachment`.
- Lokaal aanwezig: `~/.gmail-mcp/gcp-oauth.keys.json` en `~/.gmail-mcp/credentials.json`.
- In de Agent allowlist staan alleen veiligere Gmail-tools aan:
  - `draft_email`, `read_email`, `search_emails`, `modify_email`, `list_email_labels`, `create_label`, `update_label`, `get_or_create_label`.
- Send/delete/bulk-delete/filter-mutaties zijn in de flow disabled.

## E. LangFlow flow

- Nieuwe flownaam: `Hazify Shopify Agent - Ollama Gmail MCP`
- Lokale flow-id: `8fd1e0940e5c4442a8fa984a93f8f8b3`
- Componenten:
  - Chat Input
  - Agent
  - MCP Tools `hazify_mcp_local`
  - MCP Tools `gmail`
  - Chat Output
- Ollama-model: `kimi-k2.6:cloud` met tool-calling metadata.
- LangFlow versie: `1.9.2`.
- Ollama beschikbaar: `gemini-3-flash-preview:latest`, `kimi-k2.6:cloud`.
- LangFlow MCP config bijgewerkt in lokale user cache met servers `hazify_mcp_local` en `gmail`; secrets zijn niet in de repo opgeslagen.
- Hazify MCP live uitvoering vereist nog een geldig `HAZIFY_MCP_CLIENT_TOKEN`. Het lokaal aangetroffen oude token was ongeldig/inactief.
- MacUse is geprobeerd voor LangFlow UI; snapshot werkte, maar typen/navigeren vereiste macOS consent en time-outte. De flow is daarom via lokale LangFlow database/export aangemaakt en daarna via database/API-inspectie geverifieerd.

System prompt hoofdregels:

- Shopify tools gebruiken voor product/order/theme taken.
- Gmail tools gebruiken voor zoeken/lezen/labels/drafts.
- Theme-acties eerst toolbeschikbaarheid inspecteren.
- Nooit stilzwijgend live/main kiezen.
- Nieuwe sections alleen via `plan-theme-edit` -> `create-theme-section` met volledige Liquid.
- Existing edits via `search-theme-files` -> `get-theme-file` -> `patch-theme-file` of `draft-theme-artifact mode=edit`.
- Hoog-impact delete/apply/refund/delete-product tools niet gebruiken.

## F. Railway

Bekeken projecten/services:

- `Hazify-MCP-Remote` / service `Hazify-MCP-Remote`
- `Hazify-License-Service` / service `Hazify-License-Service`

MCP Remote:

- Deployment voor fixes: `65d81c69-3c88-4bae-bfb9-aec8f4e37835`, status `SUCCESS`, aangemaakt `2026-05-09T21:21:51.509Z`.
- Nieuwe deployment na push: `de54c18b-bf2b-47e7-95d0-fb318eb30bd5`, status `SUCCESS`, aangemaakt `2026-05-17T11:46:23.328Z`.
- Buildlog na deploy: build geslaagd; npm warnings voor `production Use --omit=dev`, deprecated `inflight` en deprecated `glob`; geen vulnerabilities.
- Runtime gefilterd op `error OR warn OR theme OR mcp` na deploy: alleen normale startupregel `Hazify MCP HTTP server listening on 0.0.0.0:8080 (session mode: stateless)`.
- Runtime algemeen voor deploy: normale `mcp_http_initialize`; ook recente `Token is invalid or inactive` door oude/ongeldige clienttoken-test.

License Service:

- Laatste deployment: `ae21b643-e6a7-46cb-8d04-1bff2da45076`, status `SUCCESS`, aangemaakt `2026-05-08T16:52:59.689Z`.
- Buildlog: build geslaagd; dezelfde npm deprecation warnings, geen vulnerabilities.
- Runtime: herhaalde `oauth_token_failed` met `inactive_refresh_token` en recente `mcp_token_introspect_inactive` voor ongeldig token. Geen deployment-crash gevonden.

Deploymentbeslissing:

- MCP Remote fixes waren deployment-relevant en `Hazify-MCP-Remote` is opnieuw gedeployed.
- License Service kreeg geen codewijziging en is niet gedeployed.

## G. Resterende risico's

- Een geldig Hazify MCP clienttoken moet opnieuw worden gezet als `HAZIFY_MCP_CLIENT_TOKEN` voordat de LangFlow Agent de Hazify MCP live kan gebruiken.
- `delete-theme-file`, `apply-theme-draft`, `refund-order` en product-delete tools zijn bewust niet aan de Agent blootgesteld.
- Pattern-search heeft geen REST fallback; exacte reads/writes hebben wel testdekking.
- MacUse UI-automatisering van LangFlow kon niet volledig door macOS consent-timeout; de flow is lokaal aangemaakt en database/export-verifieerd.
