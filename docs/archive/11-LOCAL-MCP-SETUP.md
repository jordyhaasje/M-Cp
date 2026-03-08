# Local MCP Setup (Legacy/Fallback)

## Wanneer gebruiken
Alleen als remote URL setup niet beschikbaar is.

## Startcommando
```bash
node ./apps/hazify-mcp-remote/dist/index.js \
  --licenseKey HZY-... \
  --licenseApiBaseUrl https://license.jouwdomein.com \
  --clientId SHOPIFY_CLIENT_ID \
  --clientSecret SHOPIFY_CLIENT_SECRET \
  --domain jouw-shop.myshopify.com
```

Alternatief:
- `--accessToken` + `--domain`

## Lokale clientconfig (Codex)
```toml
[mcp_servers.hazify-mcp]
command = "node"
args = [
  "./apps/hazify-mcp-remote/dist/index.js",
  "--licenseKey", "HZY-...",
  "--licenseApiBaseUrl", "https://license.jouwdomein.com",
  "--clientId", "SHOPIFY_CLIENT_ID",
  "--clientSecret", "SHOPIFY_CLIENT_SECRET",
  "--domain", "jouw-shop.myshopify.com"
]
```

## Verplichte variabelen
- `HAZIFY_LICENSE_KEY`
- `HAZIFY_LICENSE_API_BASE_URL`
- `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` + `MYSHOPIFY_DOMAIN`
- of `SHOPIFY_ACCESS_TOKEN` + `MYSHOPIFY_DOMAIN`

## Nadelen
- Technischer voor eindgebruiker
- Shopify credentials staan lokaal bij de klant
- Meer supportlast dan remote mode
