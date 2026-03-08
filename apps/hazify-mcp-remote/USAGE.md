# Usage voorbeelden

## Remote mode (aanbevolen)
```bash
npm run --workspace @hazify/mcp-remote start:remote
```

## Expliciet met args
```bash
node apps/hazify-mcp-remote/dist/index.js \
  --transport http \
  --mcpIntrospectionUrl https://license.example.com \
  --mcpApiKey YOUR_MCP_API_KEY
```

## Local fallback (stdio)
```bash
node apps/hazify-mcp-remote/dist/index.js \
  --transport stdio \
  --licenseKey HZY-REPLACE-ME \
  --licenseApiBaseUrl https://license.example.com \
  --clientId YOUR_CLIENT_ID \
  --clientSecret YOUR_CLIENT_SECRET \
  --domain your-store.myshopify.com
```
