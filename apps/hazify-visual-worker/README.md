# Hazify Visual Worker

Enriched reference-analysis service for section cloning. This worker stays behind a feature flag and augments the remote MCP with structured style signals for difficult or fidelity-sensitive references.

## Start
```bash
npm run --workspace @hazify/visual-worker start
```

## Endpoints
- `GET /health`
- `POST /v1/reference/analyze`
