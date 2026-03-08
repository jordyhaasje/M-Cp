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

## AI workflow: section bouwen op basis van afbeelding + referentie-URL
Belangrijk: beeldanalyse gebeurt door de AI-client (bijv. ChatGPT), niet door de MCP backend.

Aanpak:
1. Laat AI eerst de gewenste section structureren (layout, typografie, spacing, blocks, settings).
2. Laat AI daarna `import-section-to-live-theme` aanroepen met:
   - `validateSchema=true`
   - `requirePresets=true`
   - `addToTemplate=true`
   - `templateKey` (bijv. `templates/index.json`)
3. Verifieer met `get-theme-file`:
   - `sections/<handle>.liquid` bestaat en heeft `{% schema %}` + `presets`
   - template JSON bevat nieuwe section in `sections` en `order`

Waarom deze flow:
- Zonder `presets` verschijnt de section niet in **Add section** in Theme Editor.
- Zonder template insertie staat de section vaak niet op de pagina-volgorde.
