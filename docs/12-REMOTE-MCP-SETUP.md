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

## Authenticatie
### OAuth (voorkeur)
- discovery via `/.well-known/oauth-protected-resource`
- authorize/token met PKCE `S256`
- scope: `mcp:tools`

### API token (fallback)
Gebruik alleen als OAuth niet beschikbaar is in de client.

## Snelle validatie
1. `initialize` werkt
2. `tools/list` werkt
3. token revoke -> nieuwe request faalt
4. disallowed origin -> request faalt

## Theme import policy
- Hazify MCP genereert of importeert geen sections.
- Gebruik `list_theme_import_tools` om te ontdekken welke externe tooling de AI client kan inzetten.

Externe workflow:
`AI Client -> Chrome MCP / Shopify Dev MCP -> Theme modifications`
