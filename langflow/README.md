# LangFlow flows

Deze map bevat export/configuratie voor lokale LangFlow flows.

## Hazify Shopify Agent - Ollama Gmail MCP

- Export: `exports/hazify_shopify_agent_ollama_gmail_mcp.langflow.json`
- Lokale LangFlow flow-id: `8fd1e0940e5c4442a8fa984a93f8f8b3`
- Model: Ollama `kimi-k2.6:cloud`
- MCP servers:
  - `gmail` via `npx @gongrzhe/server-gmail-autoauth-mcp`
  - `hazify_mcp_local` via `scripts/langflow/hazify-local-mcp-bridge.sh`

De Hazify bridge start lokale M-Cp code met Railway environment variables van
alleen service `Hazify-MCP-Remote` en spreekt daarna de lokale HTTP MCP server
aan via stdio. Zet voor gebruik een geldig client-token in de LangFlow Desktop
omgeving:

```bash
export HAZIFY_MCP_CLIENT_TOKEN="..."
```

De export bevat bewust geen secrets.
