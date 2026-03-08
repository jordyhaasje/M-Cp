# Hazify MCP Remote

Remote Shopify MCP service op `/mcp` met Streamable HTTP als primary transport.

## Source of truth
- Runtime source: `src/`
- Build output: `dist/`

## Start (remote)
```bash
npm run --workspace @hazify/mcp-remote start:remote
```

## Start (local fallback / stdio)
```bash
npm run --workspace @hazify/mcp-remote start:fallback:stdio
```

## Security defaults
- Alleen `Authorization: Bearer` of `x-api-key`
- Query-token is niet toegestaan
- Origin allowlist check op browser-origin requests
- OAuth metadata adverteert alleen PKCE `S256`

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```
