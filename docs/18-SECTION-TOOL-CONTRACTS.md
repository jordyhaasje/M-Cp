# Section Tool Contracts

## 1) inspect-reference-section
Input:
- `referenceUrl` (required)
- `sharedImage.imageUrl` xor `sharedImage.imageBase64`
- `sharedImage.imageBase64` max `8388608` chars
- `visionHints`, `targetHint` (semantische hint)
- `targetSelector` (optioneel, expliciete CSS selector)
- `viewports` default `['desktop','mobile']`
- `timeoutMs` default `30000`

Output:
- `status`, `inspectionId`, `reference`, `target`, `extracted`, `captures`
- `quality.ready` + `quality.checks` (inspectie-kwaliteit voor generatie-gating)
- `warnings[]`, `errors[]`
- `nextRecommendedTool='generate-shopify-section-bundle'` alleen bij voldoende inspectie-kwaliteit

## 2) generate-shopify-section-bundle
Input:
- `inspectionId` (required)
- `sectionHandle`, `sectionName`, `templateHint`, `generationHints`, `maxBlocks`

Output:
- `status`, `bundleId`, `inspectionId`
- `bundle.sectionHandle`
- `bundle.files[]` (minstens `sections/<handle>.liquid`)
- `schemaSummary`, `suggestedTemplateKey`

## 3) validate-shopify-section-bundle
Input:
- `bundleId` (required)
- `themeId` optional
- `themeRole` default `main`
- `templateKey` default `templates/index.json`
- `visualMode` default `reference-only`
- `strict` default `true`
- `thresholds.desktopMismatch` default `0.12`
- `thresholds.mobileMismatch` default `0.15`

Output:
- `status`, `validationId`, `bundleId`
- `resolvedTheme { id, name, role, resolutionSource }`
- `schemaValidation`, `visualValidation`
- `importReadiness { ready, blockingIssues, warnings }`

## 4) import-shopify-section-bundle
Input:
- `validationId` xor `bundleId` (minstens één)
- `themeId` / `themeRole` / fallback `main`
- `templateKey`, `insertPosition`, `referenceSectionId`
- `sectionInstanceId`, `sectionSettings`
- `overwriteSection`, `verify`, `rollbackOnFailure`

Output:
- `status`, `importId`
- `resolvedTheme`
- `writes.section`, `writes.template`, `writes.additionalFiles`
- `verification.readback|templateInstall|themeRender`
- `rollback`

## 5) replicate-section-from-reference (compat)
- Input blijft legacy v3-compatible.
- Intern: inspect -> generate -> validate(strict) -> import.
- Output behoudt legacy velden plus:
  - `compat.deprecated=true`
  - `compat.replacementTools[]`
  - `artifacts.inspectionId|bundleId|validationId|importId`
