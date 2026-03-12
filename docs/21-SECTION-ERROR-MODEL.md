# Section Error Model

## Canonical issue shape
```json
{
  "code": "string",
  "stage": "inspection|generation|validation|import|compat",
  "severity": "error|warn",
  "blocking": true,
  "source": "hazify|chrome-mcp|shopify-dev-mcp|shopify-admin",
  "message": "string",
  "details": {}
}
```

## Core error codes
- Common:
  - `invalid_input`
  - `unauthorized`
  - `license_denied`
  - `artifact_not_found`
  - `artifact_expired`
  - `artifact_persistence_degraded`
  - `adapter_unavailable`
  - `adapter_timeout`
  - `runtime_error`
- Inspection:
  - `reference_unreachable`
  - `target_detection_failed`
  - `shared_image_unreadable`
  - `shared_image_payload_too_large`
  - `inspection_quality_insufficient`
- Generation:
  - `generation_failed`
  - `section_handle_invalid`
- Validation:
  - `schema_invalid`
  - `template_insert_invalid`
  - `visual_gate_fail`
  - `theme_context_preflight_failed`
- Import:
  - `theme_not_found`
  - `section_exists_overwrite_false`
  - `theme_write_failed`
  - `import_readback_failed`
  - `theme_context_render_failed`
  - `rollback_failed`
- Persistence:
  - `artifact_quota_exceeded`

## Stage failure contract
Elke stage retourneert bij failure:
- `status="fail"`
- `errors[]` (blocking)
- `warnings[]` (non-blocking)
- stage artifact id indien beschikbaar
- `nextRecommendedTool="none"` bij harde stop
