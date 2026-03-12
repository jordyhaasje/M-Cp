# Remote MCP Setup (Aanbevolen)

## Doel
Eindgebruikers verbinden via remote MCP zonder lokale server setup.

De publieke route gebruikt remote HTTP. De runtime default van de service staat nu ook op `http`; `stdio` blijft alleen beschikbaar via `--transport=stdio` of `npm run --workspace @hazify/mcp-remote start:fallback:stdio`.

- MCP URL: `https://hazify-mcp-remote-production.up.railway.app/mcp`
- License service: `https://hazify-license-service-production.up.railway.app`

## Onboarding flow
1. Open `/onboarding`
2. Login of signup
3. Connect Shopify store met:
   - `shopAccessToken`, of
   - `shopClientId` + `shopClientSecret`
4. Credentials en scopes worden live gevalideerd
5. Maak MCP token of gebruik OAuth connect flow

## Vereiste Shopify scopes
```text
read_products,write_products,read_customers,write_customers,read_orders,write_orders,read_fulfillments,read_inventory,write_merchant_managed_fulfillment_orders,read_themes,write_themes
```

`read_themes` en `write_themes` zijn verplicht voor theme tools.

## Authenticatie
### OAuth (voorkeur)
- discovery via `/.well-known/oauth-protected-resource`
- authorize/token met PKCE `S256`
- scope: `mcp:tools`

### API token (fallback)
Gebruik alleen als OAuth niet beschikbaar is in de client.

Voorbeeld (`mcp-remote`):
```json
{
  "command": "npx",
  "args": [
    "-y",
    "mcp-remote",
    "https://hazify-mcp-remote-production.up.railway.app/mcp",
    "--transport",
    "http-only",
    "--header",
    "x-api-key: ${HAZIFY_MCP_TOKEN}"
  ],
  "env": {
    "HAZIFY_MCP_TOKEN": "hzmcp_REPLACE_ME"
  }
}
```

## Snelle validatie
1. `initialize` werkt
2. `tools/list` werkt
3. token revoke -> nieuwe request faalt
4. disallowed origin -> request faalt

## Section workflow (staged orchestration)
Aanbevolen flow:
1. `inspect-reference-section`
2. `generate-shopify-section-bundle`
3. `validate-shopify-section-bundle`
4. `import-shopify-section-bundle`

Compat flow:
- `replicate-section-from-reference` blijft beschikbaar als wrapper, maar geeft ook artifact IDs terug (`inspectionId`, `bundleId`, `validationId`, `importId`).

Belangrijk:
- Theme-targeting:
  - expliciet `themeId` heeft prioriteit
  - anders `themeRole`
  - anders fallback naar live theme (`role=main`)
- Import alleen uitvoeren wanneer validation `status=pass` en `importReadiness.ready=true`.
- Verifieer na import met `get-theme-file` op:
  - `sections/<handle>.liquid`
  - template JSON (`sections` + `order`)
  - aanvullende geschreven bestanden
- Contractdetails: `docs/18-SECTION-TOOL-CONTRACTS.md`

## Clientselectie en hosting
- ChatGPT productie: selecteer standaard alleen Hazify MCP voor section-taken.
- Chrome DevTools MCP en Shopify Dev MCP:
  - niet customer-facing hosten als extra publieke Railway services
  - alleen intern/dev gebruiken via stdio bridge wrappers binnen `hazify-mcp-remote`
  - provider packages:
    - Chrome: `chrome-devtools-mcp`
    - Shopify Dev: `@shopify/dev-mcp` (scoped)
  - Chrome executable:
    - optioneel expliciet via `HAZIFY_SECTION_CHROME_EXECUTABLE_PATH`
    - anders auto-resolve naar Playwright Chromium executable in runtime

## Shopify referentie (voor reviewers)
- Sections: https://shopify.dev/docs/storefronts/themes/architecture/sections
- Section schema: https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema
- JSON templates: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates
- Liquid reference: https://shopify.dev/docs/api/liquid
