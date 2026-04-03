# Hazify MCP Remote
Doelgroep: developers en coding agents.

Remote Shopify MCP service op `/mcp` voor store-operaties via Shopify APIs.

Runtime: Node.js `>=22.12.0`.

## Scope
- Wel: producten, klanten, orders, tracking, refunds en theme file CRUD.
- Wel: guarded preview/apply flow via `draft-theme-artifact`, `apply-theme-draft`, `get-theme-file(s)` en `verify-theme-files`.
- Wel: reference-analyse via `analyze-reference-ui`, optioneel verrijkt door de visual worker.
- Wel: compacte section clone flow voor nieuwe sections: `prepare-section-from-reference` -> `draft-theme-artifact`.
- Niet: automatische JSON template placement of blind live section-import.
- Niet: browser automation binnen de hoofd-MCP runtime.
- Niet: image-only cloning als zelfstandige capability; gebruik URL-first met image hint.

## Start (remote)
```bash
npm run --workspace @hazify/mcp-remote start:remote
```

## Start (stdio fallback)
```bash
npm run --workspace @hazify/mcp-remote start:fallback:stdio
```

## Security defaults
- Alleen `Authorization: Bearer` of `x-api-key`
- Query-token niet toegestaan
- Origin allowlist check op requests met `Origin` header
- OAuth metadata adverteert PKCE `S256`
- MCP session mode default: `stateless` (`MCP_SESSION_MODE=stateless`)
- `stateful` mode is opt-in en vereist sticky sessions of gedeelde session store
- `DATABASE_URL` is in productie vereist voor `theme_drafts` persistence en PostgreSQL advisory locks op theme writes
- Shopify credentials worden niet via introspection gedeeld; de remote haalt per token een interne Shopify access token op via `/v1/mcp/token/exchange`

## Section flows
### Nieuwe section uit reference
- `prepare-section-from-reference` -> `draft-theme-artifact`
- Geef bij pagina's met meerdere sections een `sectionHint` of `targetHeading` mee
- `prepare-section-from-reference` levert `sectionPlan`, `sectionBlueprint`, `selectionEvidence`, `suggestedFiles`, `generationHints`, `errorCode`, `retryable` en `nextAction`
- gebruik `analyze-reference-ui` alleen voor low-level diagnose of expliciete selector-scoping
- standaard outputpolicy: één `sections/<handle>.liquid`
- URL-first met image hint

### Bestaande theme edit
- `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`

## Shopify-conforme file policy
- Standaard maakt de LLM alleen `sections/<handle>.liquid`
- Gebruik snippets/blocks/locales alleen als daar een concrete reden voor is
- Geen Liquid binnen `{% stylesheet %}` of `{% javascript %}`
- Geen automatische template/config writes; merchants plaatsen sections zelf via de Theme Editor

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```
