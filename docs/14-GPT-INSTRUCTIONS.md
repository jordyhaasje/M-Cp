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
1. Gebruik in Hazify MCP alleen `list_theme_import_tools` voor capability discovery.
2. Laat section generatie/import uitvoeren door externe tooling buiten deze repository.
3. Gebruik voor theme-planning in deze remote MCP eerst de read-only resolvertools:
   - `resolve-homepage-sections`
   - `find-theme-section-by-name`
   - `search-theme-files`
4. Gebruik `get-theme-file` en `upsert-theme-file(s)` pas nadat de targetbestanden via de resolverlaag zijn bevestigd.
5. `search-theme-files` en `resolve-homepage-sections` zijn expliciet bedoeld om tool-chaining en tokenverbruik te verlagen bij kleine theme-wijzigingen.
6. Externe keten:
   `AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`
7. Hazify MCP blijft verantwoordelijk voor store API-operaties (producten, orders, refunds, tracking, theme files), inclusief batch theme file deploy/verificatie.

## Referenties
- `docs/12-REMOTE-MCP-SETUP.md`
- `docs/20-TRACKING-WORKFLOW.md`
- `docs/30-REMOTE-MCP-DEPLOYMENT.md`
