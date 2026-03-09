# GPT Connector Policy (No Prompt Templates)

Dit document bevat operationele regels voor ChatGPT connector-gebruik.

## Doel
- Geen vaste system-prompt templates onderhouden in docs.
- Gedrag afdwingen via MCP toolcontracten en runbooks.
- Voor sections altijd de v3-flow gebruiken.

## Section policy
1. Gebruik alleen `replicate-section-from-reference`.
2. Geef minimaal `referenceUrl` mee.
3. Geef `visionHints` mee als de gebruiker een niet-publieke afbeelding in de chat uploadt.
4. `imageUrls` is optioneel voor publieke image links.
5. Voer alleen writes uit bij `status=pass`; bij `status=fail` geen mutaties uitvoeren.
6. Verifieer writes met `get-theme-file` zodra `status=pass` is geretourneerd.
7. Als output `policy.writesAllowed=false` of `errorCode` aanwezig is: stop direct en rapporteer de fout, zonder handmatige replica/import.

## Referenties
- Contract runbook: `docs/16-SECTION-REPLICA-RUNBOOK.md`
- Sections: https://shopify.dev/docs/storefronts/themes/architecture/sections
- Section schema: https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema
- JSON templates: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates
- Liquid reference: https://shopify.dev/docs/api/liquid
