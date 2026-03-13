# GPT Connector Policy (No Prompt Templates)

Dit document bevat operationele regels voor ChatGPT connector-gebruik.

## Doel
- Geen vaste system-prompt templates onderhouden in docs.
- Gedrag afdwingen via MCP toolcontracten en runbooks.
- Focus op Shopify store-operaties via de Hazify MCP.

## Theme import policy
1. Gebruik in Hazify MCP alleen `list_theme_import_tools` voor capability discovery.
2. Laat section generatie/import uitvoeren door externe tooling buiten deze repository.
3. Externe keten:
   `AI Client -> Chrome MCP / Shopify Dev MCP -> Theme modifications`
4. Hazify MCP blijft verantwoordelijk voor store API-operaties (producten, orders, refunds, tracking, theme files).

## Referenties
- `docs/12-REMOTE-MCP-SETUP.md`
- `docs/20-TRACKING-WORKFLOW.md`
- `docs/30-REMOTE-MCP-DEPLOYMENT.md`
