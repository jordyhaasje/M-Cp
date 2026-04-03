# Hazify Visual Worker

Enriched reference-analysis service for section cloning. This worker stays behind a feature flag and augments the remote MCP with structured style signals plus browser runtime hints for difficult or fidelity-sensitive URL references.

## Start
```bash
npm run --workspace @hazify/visual-worker start
```

## Endpoints
- `GET /health`
- `POST /v1/reference/analyze`

## Output focus
- Runtime layout per breakpoint
- Slider/carousel hints such as visible slides, arrows and dots
- Icon/logo presence including inline SVG snippets
- Transition and animation hints

Image inputs remain hints only; they are not interpreted as a standalone clone source.
