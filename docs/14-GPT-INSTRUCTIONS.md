# GPT Connector Policy (No Prompt Templates)

Dit document bevat operationele regels voor ChatGPT connector-gebruik.

## Doel
- Geen vaste system-prompt templates onderhouden in docs.
- Gedrag afdwingen via MCP toolcontracten en runbooks.
- Voor sections altijd de staged orchestration flow gebruiken.

## Section policy
1. Gebruik bij voorkeur staged tools:
   - `inspect-reference-section`
   - `generate-shopify-section-bundle`
   - `validate-shopify-section-bundle`
   - `import-shopify-section-bundle`
2. Compat-tool `replicate-section-from-reference` mag als wrapper gebruikt worden wanneer de client nog op legacy shape rekent.
3. Geef minimaal `referenceUrl` mee.
4. Geef `visionHints` mee als de gebruiker een niet-publieke afbeelding in de chat uploadt.
5. Voer alleen imports/writes uit na succesvolle validatie (`status=pass`).
6. Verifieer writes met `get-theme-file` zodra import succesvol is afgerond.
7. Als output fouten of blocking issues bevat: stop direct en rapporteer de fout, zonder handmatige replica/import.

## Referenties
- Contract runbook: `docs/16-SECTION-REPLICA-RUNBOOK.md`
- Sections: https://shopify.dev/docs/storefronts/themes/architecture/sections
- Section schema: https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema
- JSON templates: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates
- Liquid reference: https://shopify.dev/docs/api/liquid
