# Repo Cleanup Tracker

Laatste update: 2026-03-07 10:05 (Europe/Amsterdam)

## Doel
- Repo opschonen naar alleen actieve productieroute
- Legacy informatie archiveren zonder verlies
- Agent-documentatie updaten met exacte tech stack en system flow

## Voortgang
- [x] Inventarisatie van docs/scripts/dependencies
- [x] Legacy docs verplaatst naar `docs/archive/`
- [x] Legacy connector voorbeelden gearchiveerd
- [x] Runtime testdata verwijderd uit root `data/`
- [x] `shopify-mcp-local/node_modules` verwijderd uit workspace
- [x] `.gitignore` toegevoegd op root en in `shopify-mcp-local/`
- [x] `shopify-mcp-local/package.json` opgeschoond (onnodige scripts/dev deps verwijderd)
- [x] `package-lock.json` opnieuw gegenereerd
- [x] Nieuwe kern-docs toegevoegd (`01-TECH-STACK`, `02-SYSTEM-FLOW`)
- [x] `AGENTS.md`, `docs/00-START-HERE.md`, `docs/README.md`, root `README.md` gealigneerd
- [x] Nieuwe structuurdocs toegevoegd (`03-REPO-STRUCTURE`, `04-AGENT-RUNBOOK`)
- [x] Legacy UI testbestanden eerst verplaatst naar `archive/2026-03-04/hazify-license-service/data/` en daarna verwijderd na referentiecheck (2026-03-07)
- [x] Root legacy runtime data verplaatst naar `archive/2026-03-04/root-data/`
- [x] Discord brand asset vervangen vanuit root `discord.png`
- [x] Connectflow aangescherpt naar OAuth-first voor VS Code/Cursor (geen vooraf ingestelde API-key in deeplink)
- [x] Claude connectflow gealigneerd op officiële connectorroute (`claude.ai/settings/connectors`)
- [x] Documentatie-index opgeschoond: duplicatie tussen root `README.md` en `docs/README.md` verminderd
- [x] Perplexity setup gealigneerd op officiële `Custom Remote Connector` flow met `Streamable HTTP` transport
- [x] MCP 400-foutteksten verduidelijkt voor verkeerde transportkeuze
- [x] OAuth redirect allowlist uitgebreid voor native app schemes (`vscode://`, `cursor://`, `claude://`, `perplexity://`)
- [x] Perplexity card gebruikt nu dezelfde primaire `Connect` CTA als andere app-cards
- [x] Deeplinks gealigneerd op Stripe-patroon (`vscode.dev/redirect/...` en `cursor://.../mcp/install`)
- [x] Perplexity setup toont OAuth-first flow + expliciete API-key fallback met token-snippet
- [x] Setup modal gealigneerd op Stripe-tab UX met format-tabs (`Streamable URL`, `JSON config`, `Command`)
- [x] MCP auth hardening: `/mcp` accepteert alleen `Authorization: Bearer` en `x-api-key`
- [x] MCP auth hardening: query-token en non-Bearer fallback verwijderd
- [x] MCP transport hardening: `Origin` validatie toegevoegd op `/mcp` requests met browser-origin
- [x] OAuth hardening: PKCE verplicht en alleen `S256` toegestaan
- [x] OAuth hardening: scope gefixeerd op `mcp:tools` in DCR/authorize/token
- [x] OAuth hardening: impliciete auto-recovery van onbekende clients verwijderd; alleen gecontroleerde reconnect-flow
- [x] HTTP hardening: response security headers + body-size limiet (`MAX_BODY_BYTES`) toegevoegd
- [x] Introspectie response geminimaliseerd naar benodigde Shopify auth-velden
- [x] Smoke test script aangepast naar account-session flow (`signup` -> `connect-shopify` -> `initialize/tools/list`)
- [x] Tooling hardening: `clone-product-from-url` default `DRAFT` + variant-media mapping verificatie output
- [x] Tooling hardening: tracking carrier validatie nu strict (unsupported carrier => harde fout)
- [x] Tooling hardening: `refund-order` vereist audit metadata (`amount`, `reason`, `scope`) en schrijft audit note
- [x] Archive cleanup: ongebruikte legacy UI/test artifacts verwijderd uit `archive/2026-03-04/hazify-license-service/data/`

## Validatie
- [x] `node --check hazify-license-service/server.js`
- [x] `node --check shopify-mcp-local/dist/index.js`
- [x] `npm test` in `shopify-mcp-local/`
- [x] `npm test` in `hazify-license-service/`
