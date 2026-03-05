# Repo Cleanup Tracker

Laatste update: 2026-03-05 13:21 (Europe/Amsterdam)

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
- [x] Legacy UI testbestanden verplaatst naar `archive/2026-03-04/hazify-license-service/data/`
- [x] Root legacy runtime data verplaatst naar `archive/2026-03-04/root-data/`
- [x] Discord brand asset vervangen vanuit root `discord.png`
- [x] Connectflow aangescherpt naar OAuth-first voor VS Code/Cursor (geen vooraf ingestelde API-key in deeplink)
- [x] Claude connectflow gealigneerd op officiële connectorroute (`claude.ai/settings/connectors`)
- [x] Documentatie-index opgeschoond: duplicatie tussen root `README.md` en `docs/README.md` verminderd
- [x] Perplexity setup gealigneerd op officiële `Custom Remote Connector` flow met `Streamable HTTP` transport
- [x] MCP 400-foutteksten verduidelijkt voor verkeerde transportkeuze
- [x] OAuth autorisatie herstelt nu automatisch oude/missende client-id's op geldige redirect URI's (VS Code/Cursor recovery)
- [x] OAuth redirect allowlist uitgebreid voor native app schemes (`vscode://`, `cursor://`, `claude://`, `perplexity://`)
- [x] Perplexity card gebruikt nu dezelfde primaire `Connect` CTA als andere app-cards
- [x] Deeplinks gealigneerd op Stripe-patroon (`vscode.dev/redirect/...` en `cursor://.../mcp/install`)
- [x] Perplexity setup toont OAuth-first flow + expliciete API-key fallback met token-snippet
- [x] Setup modal gealigneerd op Stripe-tab UX met format-tabs (`Streamable URL`, `JSON config`, `Command`)

## Validatie
- [x] `node --check hazify-license-service/server.js`
- [x] `node --check shopify-mcp-local/dist/index.js`
- [x] `npm test` in `shopify-mcp-local/`
