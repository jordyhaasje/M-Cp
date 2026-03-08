# MCP Server Template

Gebruik deze template voor nieuwe MCP-servers met een harde scheiding tussen documentatie en servercode.

## Structuur
- `docs/` = functionele documentatie en runbooks
- `server/` = uitvoerbare MCP-server

## Minimale workflow
1. Schrijf toolcontract in `docs/`
2. Implementeer tool in `server/dist/tools/`
3. Registreer tool in `server/dist/index.js`
4. Valideer syntax met `node --check`
5. Werk docs bij in dezelfde commit
