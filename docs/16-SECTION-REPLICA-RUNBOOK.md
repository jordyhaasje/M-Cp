# Section Replica Runbook (v2)

## Doel
Deterministische section-replicatie voor ChatGPT-first workflows, zonder directe monolithische writes.

## Kernprincipe
Section writes verlopen altijd in 2 fasen:
1. `prepare-section-replica` (read-only)
2. `apply-section-replica` (mutating)

`sectionSpec` is verplicht als tussenlaag.

## Invoercontract
Minimale invoer:
- `referenceUrl` (verplicht)
- `sectionSpec` (verplicht)
- `imageUrls` (optioneel)

Belangrijke velden in `sectionSpec`:
- `name`, `settings`, `blocks`, `presets`
- `markup.mode`: `structured` of `liquid`
- `assets` voor CSS/JS/snippets/extra bestanden
- `mobileRules` voor responsive CSS-regels

## Fase 1: prepare-section-replica
### Wat deze stap doet
- valideert `sectionSpec` (schema-lint en referenties)
- valideert bundle paden (`assets/`, `snippets/`, `locales/`, `blocks/`)
- voert theme-context preflight uit (theme + template + order-analyse)
- draait preview snapshot-gate voor desktop/mobile
- slaat plan op met `planId`

### Verwachte output
- `planId`
- `sectionSpec` (genormaliseerd)
- `filePlan`
- `validation.preflight`
- `previewTargets`

### Statusregels
- `pass`: veilig om toe te passen
- `warn`: toepassen mag alleen als policy dit toelaat
- `fail`: niet toepassen; eerst oplossen en opnieuw preparen

## Fase 2: apply-section-replica
### Wat deze stap doet
- leest plan via `planId`
- blokkeert bij `fail`
- blokkeert bij `warn` als `allowWarn=false`
- schrijft:
  - `sections/<handle>.liquid`
  - template update (`sections` + `order`) indien geconfigureerd
  - aanvullende assets/snippets/files
- voert readback verificatie uit (indien `verify=true`)

### Verwachte output
- `theme`, `section`, `template`
- `additionalFiles`
- `verification`
- `validation.preflight` (meegenomen uit plan)

## Veelvoorkomende foutcodes
- `section_exists_overwrite_false`
- `template_missing_json`
- `template_missing_reference_section`
- `template_reference_section_missing`
- `schema_lint_error`
- `bundle_invalid_path`
- `preview_reference_unreachable`
- `preview_low_keyword_overlap`

## Legacy compatibiliteit
- `build-theme-section-bundle` en `import-section-to-live-theme` zijn wrappers op v2.
- Responses bevatten `deprecation` metadata.
- Nieuwe clients moeten direct `prepare/apply` gebruiken.

## Operationele checklist
1. Gebruik live theme (`role=main`) of expliciete `themeId`.
2. Controleer in prepare minimaal:
   - `validation.preflight.status`
   - `checks.themeContext`
   - `checks.schema`
   - `checks.bundle`
   - `checks.preview`
3. Voer apply uit met gewenste warning-policy.
4. Verifieer geschreven bestanden met `get-theme-file`.
5. Rapporteer:
   - gewijzigde keys
   - gebruikte `planId`
   - eventuele warnings/openstaande issues
