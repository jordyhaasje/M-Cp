# GPT Connector Policy (No Prompt Templates)

Dit document bevat operationele regels voor ChatGPT connector-gebruik.

## Doel
- Geen vaste system-prompt templates onderhouden in docs.
- Gedrag afdwingen via MCP toolcontracten en runbooks.
- Focus op Shopify store-operaties via de Hazify MCP.
- OAuth autorisatiebesluit loopt via `POST /oauth/authorize` (niet via query-based GET decision).
- Remote MCP gebruikt lazy Shopify token exchange: pas bij tools die Shopify-auth echt nodig hebben.

## Theme import policy
1. Gebruik in Hazify MCP alleen `list_theme_import_tools` voor capability discovery.
2. Laat section generatie/import uitvoeren door externe tooling buiten deze repository.
3. Externe keten:
   `AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`
4. Hazify MCP blijft verantwoordelijk voor store API-operaties (producten, orders, refunds, tracking, theme files), inclusief batch theme file deploy/verificatie.

## Referenties
- `docs/12-REMOTE-MCP-SETUP.md`
- `docs/20-TRACKING-WORKFLOW.md`
- `docs/30-REMOTE-MCP-DEPLOYMENT.md`
