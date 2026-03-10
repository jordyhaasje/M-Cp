# Hazify MCP Remote

Remote Shopify MCP service op `/mcp`.

## Source of truth
- Runtime source: `src/`
- Build output: `dist/`

## Start (remote)
```bash
npm run --workspace @hazify/mcp-remote start:remote
```

Gebruik dit voor productie en voor bestaande ChatGPT/Perplexity-verbindingen. De runtime-default staat op HTTP; `stdio` blijft alleen beschikbaar als expliciete fallback.

## Start (local fallback / stdio)
```bash
npm run --workspace @hazify/mcp-remote start:fallback:stdio
```

## Start (expliciet met args)
```bash
node apps/hazify-mcp-remote/dist/index.js \
  --transport http \
  --mcpIntrospectionUrl https://license.example.com \
  --mcpApiKey YOUR_MCP_API_KEY
```

## Security defaults
- Alleen `Authorization: Bearer` of `x-api-key`
- Query-token is niet toegestaan
- Origin allowlist check op browser-origin requests
- OAuth metadata adverteert alleen PKCE `S256`

## Theme tooling
- Theme file tools gebruiken Shopify Admin GraphQL als primaire laag.
- REST Asset API blijft alleen als compatibele fallback actief voor shops waar GraphQL theme management nog niet beschikbaar is.

## Section workflow (v3)
- `replicate-section-from-reference` (mutating autopipeline met preview-based visual gate en storefront render-verificatie)
- Input: `referenceUrl` (+ optioneel `visionHints`, `imageUrls`)
- Output: `status=pass|fail`, `validation`, `visualGate`, `policy`, en `writes` alleen bij `pass`
- Gegenereerde section CSS/JS wordt inline geschreven via `{% stylesheet %}` en `{% javascript %}`.
- Voor main themes verifieert de pipeline na write ook een echte storefront section render; bij falen rolt de pipeline de write terug.

## Playwright runtime
- Chromium wordt standaard geïnstalleerd via `postinstall`.
- Voor runtime-consistentie: gebruik `PLAYWRIGHT_BROWSERS_PATH=0` (aanbevolen voor Railway).

## Tests
```bash
npm run --workspace @hazify/mcp-remote test
```
