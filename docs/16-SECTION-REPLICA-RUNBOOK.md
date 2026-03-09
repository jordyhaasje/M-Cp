# Section Replica Runbook (v3)

## Doel
Deterministische section-replicatie via 1 mutating tool, met harde visuele gate vóór writes.

## Runtime prerequisites
- `playwright` + Chromium moeten beschikbaar zijn op de MCP host.
- In CI/deploy: installeer browser binaries vóór runtime-start (bijv. `npx playwright install chromium`).

## Publieke tool
- `replicate-section-from-reference`

De backend voert intern altijd deze pipeline uit:
1. capture (desktop + mobile reference snapshots)
2. detect (archetype + target element)
3. generate (Shopify section bundle)
4. lint (schema + template preflight)
5. visual gate (pixel-diff thresholds)
6. apply (alleen bij status `pass`)

## Invoercontract
Verplicht:
- `referenceUrl`

Optioneel:
- `visionHints` (voor niet-publieke chat-afbeeldingen)
- `imageUrls` (publieke image URLs)
- `themeId` of `themeRole`
- `templateKey`
- `insertPosition` + `referenceSectionId`
- `sectionHandle`
- `overwriteSection`
- `maxAttempts` (default 3, max 4)
- `verify`

## Uitvoercontract
- `status`: `pass` of `fail`
- `archetype`
- `confidence`
- `validation`:
  - `checks.themeContext`
  - `checks.schema`
  - `checks.bundle`
  - `checks.visual`
- `visualGate` met desktop/mobile mismatch ratio + thresholds
- `writes` alleen bij `status=pass`
- `errorCode` bij `status=fail`

## Archetypes (v3 start)
- `feature-tabs-media-slider` (Feature #15-achtig)
- `slideshow-pro`

Als een referentie niet matcht met ondersteunde archetypes:
- `status=fail`
- `errorCode=unsupported_archetype`
- geen writes

## Foutcodes
Minimaal ondersteund:
- `reference_unreachable`
- `target_detection_failed`
- `unsupported_archetype`
- `schema_invalid`
- `template_insert_invalid`
- `visual_gate_fail`

## Visual gate
- Desktop pass als mismatch ratio `<= 0.12`
- Mobile pass als mismatch ratio `<= 0.15`
- Bij overschrijding: `status=fail`, `errorCode=visual_gate_fail`, geen writes

## Operationele checklist
1. Gebruik live theme (`role=main`) of expliciete `themeId`.
2. Controleer in output altijd:
   - `status`
   - `validation.checks`
   - `visualGate.perViewport`
3. Alleen bij `status=pass`: readback controleren met `get-theme-file`.
4. Rapporteer:
   - section key
   - template key + section id
   - assets die geschreven zijn
   - gebruikte archetype/confidence
