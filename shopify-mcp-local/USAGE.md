# Nieuwe Shopify MCP Tools (Voorbeeld payloads)

## Verplichte startup (paid mode)
### Remote hosting (aanbevolen)
```bash
node dist/index.js \
  --transport http \
  --mcpIntrospectionUrl https://license.example.com \
  --mcpApiKey YOUR_MCP_API_KEY
```

### Legacy lokaal (fallback)
Gebruik bij lokale start altijd ook licentie-args:
```bash
node dist/index.js \
  --licenseKey HZY-REPLACE-ME \
  --licenseApiBaseUrl https://license.example.com \
  --clientId YOUR_CLIENT_ID \
  --clientSecret YOUR_CLIENT_SECRET \
  --domain your-store.myshopify.com
```

## clone-product-from-url
```json
{
  "sourceUrl": "https://vorana.nl/products/elara-jurk-met-overslaghalslijn-en-bijpassende-riem",
  "status": "DRAFT",
  "importDescription": true,
  "importMedia": true,
  "tracked": true,
  "taxable": true
}
```

Na clone:
- controleer `variantMediaMapping` in de response
- publiceer pas na bevestigde mapping

## create-product met media
```json
{
  "title": "Test Product",
  "status": "ACTIVE",
  "media": [
    {
      "originalSource": "https://cdn.shopify.com/s/files/example.jpg",
      "mediaContentType": "IMAGE",
      "alt": "Voorbeeld"
    }
  ]
}
```

## update-product met extra media
```json
{
  "id": "gid://shopify/Product/123",
  "media": [
    {
      "originalSource": "https://cdn.shopify.com/s/files/new-image.jpg",
      "mediaContentType": "IMAGE"
    }
  ]
}
```

## refund-order (gedeeltelijk)
```json
{
  "orderId": "gid://shopify/Order/123",
  "note": "Klant retour maat",
  "audit": {
    "amount": "19.95",
    "reason": "Retour verwerkt na kwaliteitsklacht",
    "scope": "partial"
  },
  "notify": true,
  "refundLineItems": [
    {
      "lineItemId": "gid://shopify/LineItem/456",
      "quantity": 1
    }
  ]
}
```

## update-order tracking (juiste fulfillment-veld, niet Aanvullende gegevens)
```json
{
  "id": "gid://shopify/Order/7094973333818",
  "tracking": {
    "number": "3SKY123456789",
    "company": "PostNL Domestic",
    "url": "https://jouw.postnl.nl/track-and-trace/",
    "notifyCustomer": false
  }
}
```

Let op:
- `customAttributes` en `metafields` zijn niet de bron voor tracking.
- Legacy keys zoals `tracking_number`, `carrier`, `tracking_url` worden automatisch omgezet naar fulfillment-tracking.
- Gebruik voor nieuwe flows altijd `update-fulfillment-tracking`.
- Carrier moet exact uit `get-supported-tracking-companies` komen (of een ondersteunde alias); anders faalt de mutatie.
- `orderId`/`id` mag ook ordernummer zijn (`1004` of `#1004`); de MCP resolve dit automatisch naar de Shopify GID.

## get-supported-tracking-companies
```json
{
  "search": "postnl",
  "limit": 20
}
```

## update-fulfillment-tracking (aanbevolen voor elke LLM)
```json
{
  "orderId": "gid://shopify/Order/7094973333818",
  "trackingNumber": "64000AA",
  "trackingCompany": "PostNL Domestic",
  "notifyCustomer": false
}
```

## set-order-tracking (beste one-shot voor LLMs)
```json
{
  "order": "#1004",
  "trackingCode": "7474SD",
  "carrier": "PostNL Domestic",
  "notifyCustomer": false
}
```

Deze tool doet automatisch een verificatie na de update en geeft een fout terug als de nieuwe trackingcode niet zichtbaar is in `tracking.shipments`.

## update-order-tracking / add-tracking-to-order (aliases)
Gebruik exact dezelfde payload als `set-order-tracking`.

## get-license-status
```json
{}
```

## get-themes
```json
{
  "role": "main",
  "limit": 20
}
```

## get-theme-file
```json
{
  "themeRole": "main",
  "key": "sections/cloudpillo-risk-free.liquid",
  "includeContent": true
}
```

## upsert-theme-file (direct file write)
```json
{
  "themeRole": "main",
  "key": "sections/cloudpillo-risk-free.liquid",
  "value": "{% schema %}{\"name\":\"Cloudpillo risico-vrij\"}{% endschema %}"
}
```

## import-section-to-live-theme (one-shot section import)
```json
{
  "sectionHandle": "cloudpillo-risk-free",
  "liquid": "<section class=\"cloudpillo-risk-free\">...</section>",
  "themeRole": "main",
  "overwrite": true
}
```

Belangrijk:
- Theme tools vereisen Shopify app scopes `read_themes` en `write_themes`.
- `import-section-to-live-theme` schrijft naar `sections/<sectionHandle>.liquid`.
