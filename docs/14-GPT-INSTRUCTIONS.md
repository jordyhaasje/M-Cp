# GPT Connector Policy (No Prompt Templates)
Doelgroep: ChatGPT / connector integraties.

Dit document bevat operationele regels voor ChatGPT connector-gebruik.

## Doel
- Geen vaste system-prompt templates onderhouden in docs.
- Gedrag afdwingen via MCP toolcontracten en runbooks.
- Focus op Shopify store-operaties via de Hazify MCP.
- OAuth autorisatiebesluit loopt via `POST /oauth/authorize` (niet via query-based GET decision).
- `GET /oauth/authorize` rendert alleen de authorize UI; de oorspronkelijke OAuth-parameters moeten intact blijven tot aan de POST-submit.
- ChatGPT connector-flows vertrouwen op behoud van `resource=https://.../mcp` en een geldige `redirect_uri`-return naar `https://chatgpt.com`.
- De interactive authorize-pagina moet daarom CSP `form-action` uitbreiden met de callback-origin uit `redirect_uri`.
- Remote MCP gebruikt lazy Shopify token exchange: pas bij tools die Shopify-auth echt nodig hebben.

## Theme import policy
1. Gebruik voor een nieuwe OS 2.0 section op een ondersteund JSON target direct `create-theme-section`.
2. Als het target/template niet expliciet bekend is, stel eerst een korte vervolgvraag en gok niet.
3. Gebruik in Hazify MCP `list_theme_import_tools` alleen voor expliciete externe review/import-vragen.
4. Gebruik voor fix/update/style-wijzigingen in deze remote MCP eerst de read-only resolvertools:
   - `resolve-homepage-sections`
   - `find-theme-section-by-name`
   - `search-theme-files`
5. Gebruik `find-theme-section-by-name` alleen voor bestaande lookup/edit-flows; niet als standaard eerste stap voor create-vragen.
6. Gebruik `get-theme-file` en `upsert-theme-file(s)` pas nadat de targetbestanden via de resolverlaag zijn bevestigd, tenzij `create-theme-section` het create-pad al afvangt.
7. `search-theme-files` en `resolve-homepage-sections` zijn expliciet bedoeld om tool-chaining en tokenverbruik te verlagen bij kleine theme-wijzigingen.
8. Externe keten:
   `AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`
9. Hazify MCP blijft verantwoordelijk voor store API-operaties (producten, orders, refunds, tracking, theme files), inclusief native section-create/place en batch theme file deploy/verificatie.

## Referenties
- `docs/12-REMOTE-MCP-SETUP.md`
- `docs/20-TRACKING-WORKFLOW.md`
- `docs/30-REMOTE-MCP-DEPLOYMENT.md`
