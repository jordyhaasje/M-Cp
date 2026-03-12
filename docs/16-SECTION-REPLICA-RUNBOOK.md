# Section Replica Runbook (Staged)

## Doel
Section-replicatie via gefaseerde orchestration met expliciete artifacts en duidelijke scheiding van inspectie, generatie, validatie en import.

## Runtime prerequisites
- `playwright` + Chromium op de MCP host.
- Browser-install via `postinstall` in `@hazify/mcp-remote`.
- Productie: `PLAYWRIGHT_BROWSERS_PATH=0`.
- Interne adapter-bridges:
  - v1 transport: stdio subprocess
  - `HAZIFY_SECTION_CHROME_MCP_STDIO_COMMAND` (+ optioneel args/cwd)
  - `HAZIFY_SECTION_SHOPIFY_DEV_MCP_STDIO_COMMAND` (+ optioneel args/cwd)
  - Aanbevolen bridge wrappers:
    - `node apps/hazify-mcp-remote/scripts/section-providers/chrome-provider-bridge.mjs`
    - `node apps/hazify-mcp-remote/scripts/section-providers/shopify-dev-provider-bridge.mjs`
  - Wrapper upstream providers:
    - Chrome: `chrome-devtools-mcp`
    - Shopify Dev: `@shopify/dev-mcp` (scoped package)
  - HTTP bridge is in v1 runtime expliciet uitgeschakeld
- Artifact storage:
  - `HAZIFY_SECTION_ARTIFACT_MODE=hybrid` (aanbevolen)
  - L2 persistence via license service `/v1/mcp/artifacts/*`
- Node runtime: `>=22.12.0` aanbevolen voor provider-compatibiliteit.

## Publieke tools
1. `inspect-reference-section`
2. `generate-shopify-section-bundle`
3. `validate-shopify-section-bundle`
4. `import-shopify-section-bundle`
5. `replicate-section-from-reference` (compat wrapper)

## Staged flow
1. **Inspect**: referentie-URL (+ optionele shared image) analyseren; `targetHint`/`visionHints` zijn semantisch, alleen `targetSelector` forceert CSS-targeting.
2. **Generate**: section bundle genereren uit `inspectionId`.
3. **Validate**: schema/template + visual checks uitvoeren op `bundleId`.
4. **Import**: bundle schrijven naar doeltheme, readback + template install + render verificatie.

## Theme-targeting regels
1. `themeId` heeft hoogste prioriteit.
2. Daarna `themeRole`.
3. Als beide ontbreken: fallback naar live theme (`role=main`).

## Compatibiliteit
- `replicate-section-from-reference` orkestreert intern dezelfde stages.
- Output behoudt legacy velden (`status`, `validation`, `visualGate`, `writes`, `policy`).
- Extra metadata:
  - `compat.deprecated=true`
  - `artifacts.inspectionId|bundleId|validationId|importId`

## Validatie en blokkering
- **Schema/template validation**: blockt import bij errors.
- **Visual validation**: blockt bij threshold-overschrijding.
  - desktop `<= 0.12`
  - mobile `<= 0.15`
- **Inspection quality gating**: generatie blockt als captures/extracted/target-confirmatie onvoldoende zijn.
- **Import verification**:
  - section readback
  - template install readback
  - storefront rendercheck (main theme strict)

## Rollback
- Bij blocking verificatiefout na write: rollback van section/template/additional files.
- Resultaat in `rollback.status` (`pass|fail|not_needed`).

## Operationele checklist
1. Start met inspect-stage en noteer `inspectionId`.
2. Gebruik artifact IDs per stage; mix geen tenant-contexten.
3. Importeer alleen na `validate.status=pass` en `importReadiness.ready=true`.
4. Controleer altijd `verification.readback`, `verification.templateInstall`, `verification.themeRender`.
5. Bij `status=fail`: rapporteer `errors[]` en voer geen handmatige writes uit.

## Referenties
- `docs/17-SECTION-ORCHESTRATION-ARCHITECTURE.md`
- `docs/18-SECTION-TOOL-CONTRACTS.md`
- `docs/19-SECTION-ARTIFACT-LIFECYCLE.md`
- `docs/21-SECTION-ERROR-MODEL.md`
