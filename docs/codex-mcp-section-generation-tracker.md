# Codex MCP Section Generation Tracker
Doelgroep: repo maintainers en coding agents.

## Objective
- Make `@hazify/mcp-remote` reliably plan, create, edit, place, and validate Shopify sections/blocks across themes from screenshot-driven and text-only prompts without weakening safety, while preserving existing non-theme Shopify MCP capabilities.

## Current Phase
- Phase 7: prompt-flow hardening for non-coding-agent clients implemented locally, commit/deploy pending

## Checklist Of Planned Work
- [x] Read attached report and `tool_log.json`
- [x] Snapshot git state and recent commits
- [x] Read required repo guidance (`docs/00-START-HERE.md`, `docs/01-TECH-STACK.md`, `docs/02-SYSTEM-FLOW.md`, `AGENTS.md`)
- [x] Inspect current MCP code paths and tests
- [x] Inspect Railway deployment/runtime reality
- [x] Consult Shopify dev MCP docs for current theme/section behavior
- [x] Consult Context7 docs for runtime/dependency details
- [x] Map report failures to current code and tests
- [x] Implement planner/validation/write/runtime fixes
- [x] Add/extend automated tests
- [x] Update docs and anti-drift checks
- [x] Run verification suite and capture results
- [x] Produce final issue -> fix -> test map

## Completed Steps
- Read `/Users/jordy/Desktop/log/MCP_Hazify_Section_Replication_Report.docx` via `textutil`.
- Read `/Users/jordy/Desktop/tool_log.json`.
- Captured initial git state:
  - Branch: `main` tracking `origin/main`
  - Working tree: clean except unrelated untracked `.playwright-cli/`
  - `git diff --stat`: no tracked changes
  - Recent commits inspected through `git log --oneline -n 12`
- Read required guidance in order:
  - `/Users/jordy/Desktop/Customer service/docs/00-START-HERE.md`
  - `/Users/jordy/Desktop/Customer service/docs/01-TECH-STACK.md`
  - `/Users/jordy/Desktop/Customer service/docs/02-SYSTEM-FLOW.md`
  - `/Users/jordy/Desktop/Customer service/AGENTS.md`
- Inspected current MCP code and tests, including:
  - `apps/hazify-mcp-remote/src/tools/planThemeEdit.js`
  - `apps/hazify-mcp-remote/src/lib/themePlanning.js`
  - `apps/hazify-mcp-remote/src/lib/themeSectionContext.js`
  - `apps/hazify-mcp-remote/src/tools/createThemeSection.js`
  - `apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
  - `apps/hazify-mcp-remote/src/tools/patchThemeFile.js`
  - `apps/hazify-mcp-remote/src/lib/themeFiles.js`
  - `apps/hazify-mcp-remote/src/lib/themeEditMemory.js`
  - `apps/hazify-mcp-remote/src/tools/registry.js`
  - `apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
  - `apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
  - `apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- Verified current remote workspace behavior with:
  - `npm run --workspace @hazify/mcp-remote test` -> pass
  - `npm run check:repo` -> pass
  - `npm run check:docs` -> fail only because the new tracker file is not yet referenced by docs and lacked the required `Doelgroep` line
- Queried Railway MCP for project/service/deployment/log reality.
- Compared `Hazify-MCP-Remote` production vs `cleanup-root-deploy` environment variables and deploy metadata.
- Confirmed via production Railway deploy logs that the active production deploy is serving recent `plan-theme-edit`, `get-theme-file(s)`, `create-theme-section`, and `draft-theme-artifact` traffic with the expected hardening behaviors.
- Consulted Shopify dev MCP (`learn_shopify_api` + `search_docs_chunks`) and Context7.
- Implemented planner classification and docs/example updates.
- Added planner regression coverage for additional required support paths: `image_slider`, `logo_wall`, and explicit `template_placement`.
- Committed and deployed the planner/docs/test hardening as commit `fb458e8` (`Harden section planning coverage and docs`) to Railway production.
- Identified a remaining prompt-compatibility friction point for normal LLM clients: exact planner-required reads were still enforced even when the target files were safely and unambiguously derivable by the server.
- Added safe exact-read auto-hydration for write flows so ordinary prompt-driven clients do not have to manually orchestrate every read step when the server can deterministically repair the missing context itself.
- Extended hardening tests for `create-theme-section`, `draft-theme-artifact`, and `patch-theme-file` to lock down that exact-read auto-hydration behavior.
- Updated this tracker with the Railway drift conclusion and re-ran docs verification.
- Re-ran docs verification after the latest tracker/support-matrix update.
- Re-ran full verification:
  - `npm run --workspace @hazify/mcp-remote test` -> pass (`64/64`)
  - `npm run check:docs` -> pass
  - `npm run build` -> pass
  - `npm run check:repo` -> pass
  - `npm test` -> pass

## Decisions And Assumptions
- Treat current code and runtime behavior as canonical over older docs/plans, per user request and `AGENTS.md`.
- Keep unrelated untracked `.playwright-cli/` untouched.
- Use the attached report/log as regression evidence, not as authoritative implementation truth.
- Use English for user-facing communication because the user wrote in English.
- Treat recent commit history as likely part of the same hardening effort and validate claims by tests/runtime, not commit messages alone.
- Prefer server-side repair over validator relaxation when a missing step is exact, deterministic, and theme-safe. This keeps normal prompt clients working while preserving the same guarded write semantics.

## Conflicts Found
- The attached report describes failures that are now already covered in code and tests:
  - exact-match / precision-first planner metadata
  - required-read enforcement before create/edit writes
  - existing key conflict handling
  - truncation protection
  - Theme Editor lifecycle validation
  - range-label/range-schema validation
  - optional href/media guards
  - theme-scale oversizing guardrails
- Repo-wide docs claim these protections exist, and the current remote test suite confirms most of them. The remaining live discrepancy so far is documentation drift around the new tracker file.
- Railway environment drift: `Hazify-MCP-Remote` production is currently deploying on Node `22.22.2`, while the `cleanup-root-deploy` environment shows an older April 4 deployment on Node `18.20.8`.
- Railway audit follow-up clarified that `cleanup-root-deploy` no longer appears to have a current env-var mismatch. Its variable keys and runtime knobs match production closely, including `NIXPACKS_NODE_VERSION=22`; the remaining drift is a stale April 4 image that predates the repo's newer Node/package baseline.
- The user's hypothesis about the active Railway deploy was correct: production logs show today's live requests already exercising recent guardrails such as `existing_section_key_conflict`, `inspection_failed_truncated`, and `missing_theme_context_reads`.
- Planner gap found during this session: broader archetypes like social strips, FAQ/collapsibles, comparison tables, before/after sliders and hero banners were safe but not explicitly classified. Fixed in source + tests.
- Additional coverage gap found during this session: `image_slider`, `logo_wall`, and explicit `template_placement` support existed in planner/runtime code but were not yet locked down with dedicated planner regression tests. Fixed in tests.
- Usability conflict found during this session: the guarded pipeline was correct but still too brittle for ChatGPT/Claude/Perplexity-style prompt clients when exact required reads were trivially derivable by the server. Resolved by auto-hydrating only exact planner/target reads instead of weakening validation or allowing broad implicit scans.

## Files Inspected
- `/Users/jordy/Desktop/log/MCP_Hazify_Section_Replication_Report.docx`
- `/Users/jordy/Desktop/tool_log.json`
- `/Users/jordy/Desktop/Customer service/docs/00-START-HERE.md`
- `/Users/jordy/Desktop/Customer service/docs/01-TECH-STACK.md`
- `/Users/jordy/Desktop/Customer service/docs/02-SYSTEM-FLOW.md`
- `/Users/jordy/Desktop/Customer service/AGENTS.md`
- `/Users/jordy/Desktop/Customer service/package.json`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/package.json`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/lib/themePlanning.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/lib/themeSectionContext.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/lib/themeFiles.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/lib/themeEditMemory.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/lib/themeReadHydration.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/tools/planThemeEdit.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/tools/createThemeSection.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/tools/patchThemeFile.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/tools/registry.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/tests/toolHardening.test.mjs`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/README.md`
- `/Users/jordy/Desktop/Customer service/docs/README.md`
- `/Users/jordy/Desktop/Customer service/docs/03-THEME-SECTION-GENERATION.md`

## Files Changed
- `/Users/jordy/Desktop/Customer service/docs/codex-mcp-section-generation-tracker.md`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/lib/themeSectionContext.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/lib/themeReadHydration.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/tools/createThemeSection.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/src/tools/patchThemeFile.js`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/tests/themePlanning.test.mjs`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/tests/createThemeSection.test.mjs`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/tests/toolHardening.test.mjs`
- `/Users/jordy/Desktop/Customer service/apps/hazify-mcp-remote/README.md`
- `/Users/jordy/Desktop/Customer service/docs/README.md`
- `/Users/jordy/Desktop/Customer service/docs/00-START-HERE.md`
- `/Users/jordy/Desktop/Customer service/docs/03-THEME-SECTION-GENERATION.md`
- `/Users/jordy/Desktop/Customer service/AGENTS.md`
- `/Users/jordy/Desktop/Customer service/docs/02-SYSTEM-FLOW.md`

## Tests Added/Run + Results
- `npm run --workspace @hazify/mcp-remote test` -> passed (`64/64`)
- `npm run check:repo` -> passed
- `npm run check:docs` -> failed
  - `docs/README.md`: missing reference to `docs/codex-mcp-section-generation-tracker.md`
  - `docs/00-START-HERE.md`: missing reference to `docs/codex-mcp-section-generation-tracker.md`
  - tracker file initially missed required `Doelgroep` line
- `npm run check:docs` -> passed after doc wiring + new examples doc
- `npm run build` -> passed
- `npm test` -> passed
- `npm run check:docs` -> passed again after the final tracker update
- `npm run --workspace @hazify/mcp-remote test -- tests/themePlanning.test.mjs` -> passed (`64/64`; current runner still executes the full mcp-remote suite)
- `npm run check:docs` -> passed again after the latest tracker/support-matrix update
- `npm run check:docs` -> passed again after the final tracker-only update
- `npm run --workspace @hazify/mcp-remote test` -> passed again after exact-read auto-hydration changes
- `npm run build` -> passed again after exact-read auto-hydration changes
- `npm run check:docs` -> passed again after generated tool docs updated
- `npm run check:repo` -> passed again after exact-read auto-hydration changes
- `npm test` -> passed again after exact-read auto-hydration changes
- Residual noise observed during tests/build, but non-failing:
  - Node `punycode` deprecation warning
  - expected test-path logs for rejected carriers / unauthorized requests

## Shopify Dev MCP Docs Consulted
- `learn_shopify_api(api: "liquid", model: "none")`
- `search_docs_chunks` for:
  - sections/blocks schema and `block.shopify_attributes`
  - `enabled_on` / `disabled_on`
  - JSON template structure
  - `video` vs `video_url`
  - Theme Editor events

## Context7 Docs Consulted
- Resolved and queried `/websites/shopify_dev_storefronts_themes`
  - section schema attributes
  - JSON template structure
  - Theme Editor JavaScript events
  - block rendering guidance including `block.shopify_attributes`
  - Theme Check workflow context from Shopify Themes docs

## Railway MCP Findings
- Railway CLI authenticated and usable.
- Projects found:
  - `Hazify-MCP-Remote`
  - `Hazify-License-Service`
  - `ThemeDeployBot`
  - `Hazify`
- Current workspace linkage:
  - repo root / `apps/hazify-mcp-remote` -> `Hazify-MCP-Remote`
  - `apps/hazify-license-service` -> `Hazify-License-Service`
- Deployment findings:
  - `Hazify-MCP-Remote` production latest success before the current local prompt-flow hardening: `2026-04-20T19:05:34Z`, deployment `9624c840-b0ac-430a-92c0-966b95efd7eb`, commit `fb458e8` (`Harden section planning coverage and docs`), Node `22.22.2`
  - `Hazify-MCP-Remote` `cleanup-root-deploy` latest success: `2026-04-04T08:31:56Z`, Node `18.20.8`
  - `Hazify-License-Service` production latest success: `2026-04-19T07:44:40Z`, Node `22.22.2`
- Safe config comparison:
  - `Hazify-MCP-Remote` production and `cleanup-root-deploy` currently expose the same application-level variable key set and the same service-level deploy knobs.
  - The cleanup environment also has the Node override set to `22`, so the observed runtime gap is not explained by present-day Railway variables.
  - Most likely explanation: `cleanup-root-deploy` has simply not been rebuilt since the older `>=18.18.0` package baseline that existed on April 4, 2026.
- Logs inspected:
  - No theme-write/runtime error trail surfaced in Railway deploy logs; current logs are mostly startup/build warnings.
  - Production deploy logs also confirm live traffic on April 20, 2026 for `plan-theme-edit`, `get-theme-file(s)`, `create-theme-section`, and `draft-theme-artifact`.
  - Recent production responses include the expected hardened outcomes:
    - `existing_section_key_conflict`
    - `inspection_failed_truncated`
    - `missing_theme_context_reads`
    - successful `preview_ready` drafts after the required planner/read steps
  - Production/deploy warnings observed:
    - repeated `npm warn config production Use --omit=dev instead`
    - `punycode` deprecation warning during build/start
    - MCP remote deploy/start warning about binding `0.0.0.0` without DNS rebinding protection

## Open Issues
- No failing tests or repo gates remain.
- Railway cleanup environment still appears stale relative to production (`Node 18` image vs current `Node 22` baseline); no code change applied in this session.
- Production Railway deploy logs remain sparse for theme-write/runtime behavior; they currently expose mostly startup/build warnings rather than request-level theme diagnostics.
- The exact-read auto-hydration hardening is still only local until the next commit + deploy in this session.

## Exact Next Step / Command
- `git add docs/codex-mcp-section-generation-tracker.md apps/hazify-mcp-remote/src/lib/themeReadHydration.js apps/hazify-mcp-remote/src/tools/createThemeSection.js apps/hazify-mcp-remote/src/tools/draftThemeArtifact.js apps/hazify-mcp-remote/src/tools/patchThemeFile.js apps/hazify-mcp-remote/tests/createThemeSection.test.mjs apps/hazify-mcp-remote/tests/draftThemeArtifact.test.mjs apps/hazify-mcp-remote/tests/toolHardening.test.mjs AGENTS.md docs/02-SYSTEM-FLOW.md && git commit -m "Auto-hydrate exact theme reads for write flows"` and deploy `apps/hazify-mcp-remote` to Railway production.
