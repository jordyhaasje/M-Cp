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
- Dynamic client registration zonder `token_endpoint_auth_method` valt terug op public client (`none`)
- Legacy DCR-clients die eerder foutief als `client_secret_*` zijn opgeslagen, mogen zonder secret verder voor native/public redirect URI's (loopback/custom scheme) om VS Code/Codex reconnects compatibel te houden.
- scope: `mcp:tools`
- server-side tokenvalidatie via `/v1/mcp/token/introspect`
- interne Shopify token-exchange via `/v1/mcp/token/exchange` (geen Shopify secrets in introspection payload)
- Voor native/desktop clients met opaque origin (bijv. `vscode-webview://...`): voeg `null` toe aan `HAZIFY_MCP_ALLOWED_ORIGINS`.

### API token (fallback)
Gebruik alleen als OAuth niet beschikbaar is in de client.

## Snelle validatie
1. `initialize` werkt
2. `tools/list` werkt
3. token revoke -> nieuwe request faalt
4. disallowed origin -> request faalt
5. stateless mode (`MCP_SESSION_MODE=stateless`) werkt zonder `mcp-session-id`

## Theme import policy
- Hazify MCP genereert of importeert geen sections.
- Hazify MCP ondersteunt wel remote theme file deploy/verificatie:
  - single-file: `get-theme-file`, `upsert-theme-file`, `delete-theme-file`
  - batch v2: `get-theme-files`, `upsert-theme-files`, `verify-theme-files`
- Gebruik `list_theme_import_tools` alleen voor metadata/advisering over externe tooling (bijv. lokale Chrome MCP en Shopify Dev MCP).

Externe workflow:
`AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`
