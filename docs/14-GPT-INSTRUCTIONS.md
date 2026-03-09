# GPT Connector Policy (No Prompt Templates)

Dit document bevat operationele regels voor ChatGPT connector-gebruik.

## Doel
- Geen vaste system-prompt templates onderhouden in docs.
- Gedrag afdwingen via MCP toolcontracten en runbooks.
- Voor sections altijd de v2-flow gebruiken.

## Section policy
1. Gebruik `prepare-section-replica` als eerste stap.
2. Geef minimaal `referenceUrl` + optionele `imageUrls` mee; laat `sectionSpec` alleen weg als auto-generatie gewenst is.
3. Controleer `validation.preflight` inclusief `themeContext`, `schema`, `bundle`, `preview`.
4. Gebruik `apply-section-replica` alleen bij status `pass`.
5. Verifieer writes met `get-theme-file`.
6. Bij `schema_lint_error`: corrigeer lege defaults (bijv. `text` setting default `""` is ongeldig).

## Legacy tools
- `build-theme-section-bundle` en `import-section-to-live-theme` bestaan tijdelijk als deprecated wrappers, maar staan standaard uit.
- Nieuwe implementaties moeten direct op `prepare/apply` bouwen.

## Referenties
- Contract runbook: `docs/16-SECTION-REPLICA-RUNBOOK.md`
- Sections: https://shopify.dev/docs/storefronts/themes/architecture/sections
- Section schema: https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema
- JSON templates: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates
- Liquid reference: https://shopify.dev/docs/api/liquid
