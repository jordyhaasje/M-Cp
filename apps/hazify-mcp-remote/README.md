# Hazify MCP Remote
Doelgroep: developers en coding agents.

Remote Shopify MCP service op `/mcp` voor store-operaties via Shopify APIs. Runtime: Node.js `>=22.12.0`.

## Scope
- Producten, varianten, opties, klanten, orders, fulfillment-tracking en refunds.
- Theme file discovery/read/search/patch/draft/apply/verify/delete.
- Nieuwe sections via `plan-theme-edit` en `create-theme-section`.
- Bestaande theme edits via `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact` of `patch-theme-file`.
- Geen automatische live template placement zonder expliciete gebruikersvraag.
- Geen browser automation binnen de MCP runtime.

## Start
Vanaf de repo-root:
```bash
HAZIFY_SERVICE_MODE=mcp node scripts/start-service.mjs
```

Railway gebruikt dezelfde directe Node-start via root `railway.json`. Voor de MCP Remote kopieert `scripts/start-service.mjs` `src/` naar `dist/` voordat de service start.

Lokale service-debug:
```bash
npm run --workspace @hazify/mcp-remote start:remote
```

## Security Defaults
- Alleen `Authorization: Bearer` of `x-api-key`; query-tokens zijn niet toegestaan.
- Unknown MCP scopes falen dicht; alleen `mcp:tools`, `mcp:tools:read` en `mcp:tools:write` zijn geldig.
- Token-introspectie moet matchen met de publieke MCP resource/audience.
- Tool-entitlements gelden voor aliasnaam en canonieke toolnaam.
- `MCP_SESSION_MODE=stateless` is de standaard; stateful mode vereist expliciete productiebevestiging.
- `DATABASE_URL` is verplicht voor `theme_drafts`, verify/apply state en PostgreSQL advisory locks.
- Shopify credentials worden server-side via token-exchange opgehaald en nooit aan de MCP client teruggegeven.

## Theme Edit Flow
- De gebruiker kiest altijd het doeltheme. `themeRole` zonder `themeId` is alleen veilig voor `main`; voor development/unpublished/demo themes is een exact `themeId` nodig.
- Nieuwe section: `plan-theme-edit` -> exacte compacte reads -> `create-theme-section`.
- Bestaande single-file edit: `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact` of `patch-theme-file`.
- Native product-blocks, theme blocks en template placement starten met `plan-theme-edit`.
- `apply-theme-draft` is alleen voor het promoten van een bestaand draft en vereist `confirmation="APPLY_THEME_DRAFT"` plus `reason`.
- `preview_ready` en `applied` vereisen een geslaagde verify-after-write.
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`.
- Zie `docs/03-THEME-SECTION-GENERATION.md` voor de volledige section/codegen contracten.

## Operations
- `mcp_http_tool_call_finished`: tool-call succesvol.
- `mcp_http_tool_call_domain_failed`: gecontroleerde tool-failure met compacte `failureSummary`.
- `mcp_http_tool_call_failed`: echte runtime/protocol exception.
- Elke response krijgt `X-Request-Id`; dezelfde `requestId` staat in JSON logs.
- Gebruik `npm run release:status` om lokale runtime-impact en redeploy-scope te bepalen.
- Gebruik `npm run smoke:prod` pas na deploy op live Railway URLs.

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```

Voor repo-brede release-gates:
```bash
npm run release:preflight
npm audit --omit=dev
```
