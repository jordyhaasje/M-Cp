# GPT Connector Policy (No Prompt Templates)

Dit document bevat operationele regels voor ChatGPT connector-gebruik.

## Doel
- Geen vaste system-prompt templates onderhouden in docs.
- Gedrag afdwingen via MCP toolcontracten en runbooks.
- Voor sections altijd de v2-flow gebruiken.

## Section policy
1. Gebruik `prepare-section-replica` als eerste stap.
2. Controleer `validation.preflight` inclusief `themeContext`, `schema`, `bundle`, `preview`.
3. Gebruik `apply-section-replica` alleen bij toegestane status (`pass` of `warn` volgens policy).
4. Verifieer writes met `get-theme-file`.

## Legacy tools
- `build-theme-section-bundle` en `import-section-to-live-theme` bestaan tijdelijk als deprecated wrappers.
- Nieuwe implementaties moeten direct op `prepare/apply` bouwen.

## Referenties
- Contract runbook: `docs/16-SECTION-REPLICA-RUNBOOK.md`
- Sections: https://shopify.dev/docs/storefronts/themes/architecture/sections
- Section schema: https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema
- JSON templates: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates
- Liquid reference: https://shopify.dev/docs/api/liquid
