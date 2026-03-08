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
2. Gebruik primair `build-theme-section-bundle`:
   - schrijft section liquid
   - valideert schema + presets
   - voegt section toe aan template order
   - schrijft extra assets/snippets
   - verifieert geschreven bestanden
3. Gebruik `import-section-to-live-theme` alleen als fallback voor losse section writes.

Waarom deze flow:
- Zonder `presets` verschijnt de section niet in **Add section** in Theme Editor.
- Zonder template insertie staat de section vaak niet op de pagina-volgorde.

## Eenmalige GPT-instructie (niet per chat)
Plaats dit in de GPT system instructions:

```text
Bij verzoeken om Shopify section implementatie moet je tools gebruiken i.p.v. alleen uitleg geven.
Gebruik eerst build-theme-section-bundle voor section + template + assets/snippets.
Gebruik alleen fallback tools (import-section-to-live-theme, upsert-theme-file) als dat expliciet nodig is.
Geef na uitvoering kort: welke bestanden zijn gewijzigd en welke verificatie is gedaan.
```

## Shopify referentie (voor AI en reviewers)
- Sections: https://shopify.dev/docs/storefronts/themes/architecture/sections
- Section schema: https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema
- JSON templates: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates
- Liquid reference: https://shopify.dev/docs/api/liquid
