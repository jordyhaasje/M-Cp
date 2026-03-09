# Remote MCP Setup (Aanbevolen)

## Doel
Eindgebruikers verbinden via remote MCP zonder lokale server setup.

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

## Section workflow (ChatGPT-first)
Belangrijk: beeldanalyse gebeurt door de AI-client (bijv. ChatGPT), niet door de MCP backend.

Verplichte flow:
1. `prepare-section-replica`
2. controleer `validation.preflight.status` + `checks` + `previewTargets`
3. `apply-section-replica` (alleen bij status `pass` of `warn` volgens policy)
4. verifieer met `get-theme-file` op:
   - `sections/<handle>.liquid`
   - template JSON (`sections` + `order`)
   - geschreven assets/snippets

Inputcontract voor gebruikers:
- korte opdracht
- referentie-URL (verplicht)
- optionele afbeelding(en)

## Clientselectie en hosting
- ChatGPT productie: selecteer standaard alleen Hazify MCP voor section-taken.
- Chrome DevTools MCP en Shopify Dev MCP:
  - niet customer-facing hosten als extra publieke Railway services
  - alleen intern/dev gebruiken wanneer nodig voor visuele controle of extra validatie

## Shopify referentie (voor reviewers)
- Sections: https://shopify.dev/docs/storefronts/themes/architecture/sections
- Section schema: https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema
- JSON templates: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates
- Liquid reference: https://shopify.dev/docs/api/liquid
