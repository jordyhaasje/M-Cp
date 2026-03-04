# Implementatie Tracker

Laatste update: 2026-03-04 (Europe/Amsterdam)

## Scope
- MCP tool-API LLM-vriendelijker maken
- Unieke gebruiker/tenant gedrag valideren en verbeteren
- Documentatie reduceren en structureren
- Checks + live validatie
- OAuth voor multi-client connecties toevoegen
- Onboarding UX compacter en minder technisch maken

## Voortgang
- [x] Fase 1: audit + ontwerp afbakenen
- [x] Fase 2a: codebasis verbeterd
  - [x] structured MCP responses toegevoegd
  - [x] per-tenant tool execution lock i.p.v. globale lock
  - [x] tool descriptions + annotations centraal toegevoegd
- [x] Fase 2b: aanvullende tenant/LLM verbeteringen
  - [x] onboarding beschermt tegen onbedoeld tenant-overschrijven bij andere shopdomain
- [x] Fase 3: docs reduceren/samenvoegen
  - [x] remote setup + customer onboarding samengevoegd in `docs/12-REMOTE-MCP-SETUP.md`
  - [x] redundante `docs/40-CUSTOMER-ONBOARDING.md` verwijderd
- [x] Fase 4: volledige checks en live validatie
  - [x] beide Railway deployments succesvol
  - [x] live onboarding -> initialize -> tools/list gevalideerd
  - [x] mcp-remote OAuth register fallback niet meer gezien bij invalid token
- [x] Fase 5: OAuth + onboarding flow verbetering (lokaal)
  - [x] License service OAuth endpoints toegevoegd (`/oauth/register`, `/oauth/authorize`, `/oauth/token`)
  - [x] OAuth discovery toegevoegd (`/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`)
  - [x] MCP service protected resource metadata toegevoegd (`/.well-known/oauth-protected-resource`)
  - [x] MCP unauthorized responses geven nu `401 + WWW-Authenticate` met `resource_metadata`
  - [x] Compat routes toegevoegd voor legacy clients (`/register`, `/authorize`, `/token`)
  - [x] Onboarding pagina opnieuw opgebouwd met client tabs, connect-buttons en snippet modal
  - [x] Overbodige technische output verborgen onder `Advanced output`
- [x] Fase 6: live deploy + productie smoke na OAuth rollout
  - [x] Railway deploy `Hazify-License-Service` succesvol (`5b612f3e-d10d-494e-aecb-0f4de4eccfab`)
  - [x] Railway deploy `Hazify-MCP-Remote` succesvol (`fe1590b8-b035-43bf-8c9e-e952a2b60ebe`)
  - [x] Live smoke OAuth flow geslaagd op productie URLs
  - [x] Live smoke header-token flow geslaagd op productie URLs
- [x] Fase 7: onboarding professionalisering + ChatGPT DCR compat
  - [x] DCR response aangepast: `client_secret` altijd string
  - [x] one-click install links toegevoegd voor Cursor en VS Code
  - [x] ChatGPT tab vereenvoudigd naar minimale OAuth flow
  - [x] fallback snippets behouden onder compact modal/advanced
  - [x] live deploy + smoke op nieuwe onboarding en DCR fix
  - [x] Railway deploy `Hazify-License-Service` succesvol (`9ebe930c-0ec7-4592-8cfb-46a125fe94ee`)

## Checks log
- [x] `node --check shopify-mcp-local/dist/index.js`
- [x] `node --check hazify-license-service/server.js`
- [x] lokale onboarding tenant-isolatie test (zelfde license, ander domein)
- [x] lokale MCP integratietest (`initialize`, `tools/list`, `tools/call get-license-status`)
- [x] live `tools/list` validatie incl. descriptions + annotations
- [x] live smoke script: `hazify-license-service/scripts/run-free-onboarding-smoke-test.sh`
- [x] lokale OAuth integratietest:
  - [x] onboarding connect -> OAuth client register -> authorize -> token exchange
  - [x] OAuth access token is actief via `/v1/mcp/token/introspect`
  - [x] MCP route zonder token geeft `401` + `WWW-Authenticate` header
  - [x] `.well-known` endpoints op MCP en license service geven metadata terug
- [x] live deploy smoke (productie):
  - [x] `/onboarding` bevat nieuwe compacte tabs/modal UI
  - [x] OAuth register/authorize/token werkt op live license service
  - [x] MCP `.well-known` endpoints werken op live remote service
  - [x] `initialize` werkt met OAuth access token
  - [x] `initialize` werkt met direct `x-api-key` token
  - [x] legacy `/register` op MCP host redirect naar auth server (`307`)
- [x] live onboarding professionalisering smoke:
  - [x] onboarding HTML bevat one-click labels/buttons (`Install in Cursor`, `Install in VS Code`, `Open ChatGPT connector`)
  - [x] onboarding script bevat geldige deeplinks (`vscode:mcp/install`, `cursor.com/en-US/install-mcp`)
  - [x] `/oauth/register` met `token_endpoint_auth_method=none` retourneert string `client_secret`
  - [x] end-to-end OAuth init op live MCP endpoint geslaagd

## Geraadpleegde online documentatie
- OpenAI MCP docs (install links VS Code/Cursor): `https://developers.openai.com/resources/docs-mcp`
- OpenAI ChatGPT connector docs (MCP auth flow): `https://platform.openai.com/docs/chatgpt-connectors/mcp`
- MCP authorization spec (OAuth/DCR context): `https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization`
