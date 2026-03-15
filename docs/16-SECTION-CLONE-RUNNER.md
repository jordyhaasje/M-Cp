# Section Clone Runner (Lokaal + Remote)

## Doel
Standaard workflow voor snelle, schaalbare section-clones:
- extractie en validatie lokaal
- deploy en verificatie remote via Hazify MCP

## Pipeline
1. Chrome MCP voert exact 2 extract-passes uit:
   - desktop
   - mobile
2. Output wordt geconsolideerd naar compacte `SectionSpec` JSON.
3. Section compiler zet `SectionSpec` om naar template-family (bijv. `timeline-progress`).
4. Shopify Dev MCP draait `validate_theme` lokaal op de gegenereerde files.
5. Hazify remote voert deployment uit via `upsert-theme-files`.
6. Hazify remote verifieert de write via `verify-theme-files` (of `verifyAfterWrite=true`).
7. Runner rapporteert: files, validatiestatus, verify-status, afwijkingen.

## Call Budget (richtlijn)
- Hazify calls per clone in deploy/verify pad: maximaal 4.
- Gebruik metadata-first reads/verifies (`includeContent=false`) tenzij content echt nodig is.
- Gebruik batch tooling als default; single-file tools alleen voor gerichte correcties.

## Editable Output Contract
Elke opgeleverde section moet editor-aanpasbaar zijn.

Vereist in schema/settings:
1. Section settings:
   - heading
   - intro
   - kleuren
   - fonts
   - spacing
2. Blocks voor stappen/items:
   - badge
   - title
   - text
   - icon of image

Regels:
- Geen hardcoded-only content zonder schema-veld.
- Vermijd output die in Theme Editor eindigt met “No customizable settings available”, tenzij expliciet gewenst.

## Verantwoordelijkheden
- Lokaal (Chrome MCP + Shopify Dev MCP): extractie, review, validatie.
- Hazify remote: Shopify data-plane voor batch deploy/verificatie.
- Niet in Hazify remote: browser automation, section-generatie, section-import.

## Keten
`AI Client + local MCPs -> prepared theme files -> Hazify remote deploy/verify`
