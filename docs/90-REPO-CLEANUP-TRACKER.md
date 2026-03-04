# Repo Cleanup Tracker

Laatste update: 2026-03-04 22:55 (Europe/Amsterdam)

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

## Validatie
- [x] `node --check hazify-license-service/server.js`
- [x] `node --check shopify-mcp-local/dist/index.js`
- [x] `npm test` in `shopify-mcp-local/`
