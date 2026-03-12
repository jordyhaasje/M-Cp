import { GenerateShopifySectionBundleInputSchema } from "../contracts.js";
import { createIssue, normalizeUnknownError, toBlockingAndWarnings } from "../error-model.js";
import { generateArtifactId } from "../artifacts/artifact-id.js";
import { expiresAtIso } from "../artifacts/artifact-ttl.js";
import { normalizeSectionHandle } from "../../lib/sectionReplicationV3.js";

const isoNow = () => new Date().toISOString();
const MIN_SEMANTIC_TEXT_CANDIDATES = 2;
const MIN_SEMANTIC_IMAGE_CANDIDATES = 1;
const MIN_FALLBACK_TEXT_CANDIDATES = 1;

const slugifyFallback = (raw) =>
  String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "") || "generated-section";

const take = (values, count, fallback = []) => {
  const next = Array.isArray(values) ? values.filter((entry) => typeof entry === "string" && entry.trim()) : [];
  return next.slice(0, count).length ? next.slice(0, count) : fallback;
};

const hasCaptureData = (capture) =>
  Boolean(
    capture &&
      typeof capture === "object" &&
      typeof capture.screenshotBase64 === "string" &&
      capture.screenshotBase64.trim().length > 0 &&
      Number(capture.width) > 0 &&
      Number(capture.height) > 0
  );

const modeFromFlags = ({ visualReady, semanticReady, fallbackReady }) => {
  if (visualReady && semanticReady) {
    return "full-visual-semantic";
  }
  if (semanticReady) {
    return "semantic-only";
  }
  if (fallbackReady) {
    return "low-confidence-fallback";
  }
  return "blocked";
};

const resolveInspectionGenerationBasis = (inspectionArtifact) => {
  const quality = inspectionArtifact?.payload?.quality;

  if (quality && typeof quality === "object") {
    const visualReady = Boolean(quality.visualReady);
    const semanticReady = Boolean(quality.semanticReady);
    const fallbackReady = !semanticReady && visualReady;
    const generationReady =
      typeof quality.generationReady === "boolean"
        ? quality.generationReady
        : typeof quality.ready === "boolean"
          ? quality.ready
          : semanticReady || fallbackReady;

    return {
      mode: typeof quality.mode === "string" && quality.mode.trim().length > 0
        ? quality.mode
        : modeFromFlags({ visualReady, semanticReady, fallbackReady }),
      visualReady,
      semanticReady,
      generationReady,
      fallback: !visualReady || !semanticReady,
    };
  }

  const extracted = inspectionArtifact?.payload?.extracted || {};
  const textCandidates = Array.isArray(extracted.textCandidates)
    ? extracted.textCandidates.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const imageCandidates = Array.isArray(extracted.imageCandidates)
    ? extracted.imageCandidates.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];

  const captures = inspectionArtifact?.payload?.captures || {};
  const visualReady = hasCaptureData(captures.desktop) && hasCaptureData(captures.mobile);

  const target = inspectionArtifact?.payload?.target || {};
  const targetConfirmed =
    (typeof target.selector === "string" && target.selector.trim().length > 0) ||
    (typeof target.reasoning === "string" && target.reasoning.trim().length > 0);

  const semanticReady =
    targetConfirmed &&
    textCandidates.length >= MIN_SEMANTIC_TEXT_CANDIDATES &&
    imageCandidates.length >= MIN_SEMANTIC_IMAGE_CANDIDATES;
  const fallbackReady =
    !semanticReady &&
    targetConfirmed &&
    visualReady &&
    textCandidates.length >= MIN_FALLBACK_TEXT_CANDIDATES;
  const generationReady = semanticReady || fallbackReady;

  return {
    mode: modeFromFlags({ visualReady, semanticReady, fallbackReady }),
    visualReady,
    semanticReady,
    generationReady,
    fallback: !visualReady || !semanticReady,
  };
};

const buildSectionLiquid = ({ sectionHandle, sectionName, textCandidates, imageCandidates }) => {
  const heading = textCandidates[0] || sectionName || "Generated section";
  const body = textCandidates[1] || "Deze sectie is gegenereerd op basis van de referentie-inspectie.";
  const imageUrl = imageCandidates[0] || "";

  const schema = {
    name: sectionName || sectionHandle.replace(/[-_]+/g, " "),
    settings: [
      { type: "text", id: "heading", label: "Heading", default: heading },
      { type: "textarea", id: "body", label: "Body", default: body },
      { type: "url", id: "image_url", label: "Image URL", default: imageUrl },
    ],
    presets: [
      {
        name: sectionName || sectionHandle.replace(/[-_]+/g, " "),
        category: "Custom",
      },
    ],
  };

  const liquid = `<section class="hz-generated-section" data-hz-section="${sectionHandle}">
  <div class="page-width">
    <h2>{{ section.settings.heading | escape }}</h2>
    <p>{{ section.settings.body | escape }}</p>
    {% if section.settings.image_url != blank %}
      <img src="{{ section.settings.image_url | escape }}" alt="{{ section.settings.heading | escape }}" loading="lazy">
    {% endif %}
  </div>
</section>

{% schema %}
${JSON.stringify(schema, null, 2)}
{% endschema %}
`;

  return {
    liquid,
    schemaSummary: {
      settingsCount: Array.isArray(schema.settings) ? schema.settings.length : 0,
      blocksCount: Array.isArray(schema.blocks) ? schema.blocks.length : 0,
      presetsCount: Array.isArray(schema.presets) ? schema.presets.length : 0,
    },
  };
};

export const runGenerateStage = async ({ input, runtime }) => {
  const parsedInput = GenerateShopifySectionBundleInputSchema.safeParse(input);
  if (!parsedInput.success) {
    const errors = parsedInput.error.issues.map((entry) =>
      createIssue({
        code: "invalid_input",
        stage: "generation",
        severity: "error",
        blocking: true,
        source: "hazify",
        message: `Input '${entry.path.join(".") || "root"}' is ongeldig: ${entry.message}`,
      })
    );

    return {
      action: "generate_shopify_section_bundle",
      stage: "generation",
      status: "fail",
      performedBy: "hazify",
      bundleId: null,
      inspectionId: String(input?.inspectionId || ""),
      bundle: null,
      generationBasis: {
        mode: "blocked",
        visualReady: false,
        semanticReady: false,
        generationReady: false,
        fallback: false,
      },
      errors,
      warnings: [],
      nextRecommendedTool: "none",
    };
  }

  const normalizedInput = parsedInput.data;
  const tenantId = String(runtime.executionContext?.tenantId || "stdio-local");

  try {
    const inspection = await runtime.artifactStore.get(tenantId, normalizedInput.inspectionId);
    if (!inspection || inspection.type !== "inspection") {
      return {
        action: "generate_shopify_section_bundle",
        stage: "generation",
        status: "fail",
        performedBy: "hazify",
        bundleId: null,
        inspectionId: normalizedInput.inspectionId,
        bundle: null,
        generationBasis: {
          mode: "blocked",
          visualReady: false,
          semanticReady: false,
          generationReady: false,
          fallback: false,
        },
        errors: [
          createIssue({
            code: "artifact_not_found",
            stage: "generation",
            severity: "error",
            blocking: true,
            source: "hazify",
            message: `inspectionId '${normalizedInput.inspectionId}' niet gevonden voor deze tenant.`,
          }),
        ],
        warnings: [],
        nextRecommendedTool: "none",
      };
    }

    const generationBasis = resolveInspectionGenerationBasis(inspection);

    if (inspection.status !== "pass") {
      return {
        action: "generate_shopify_section_bundle",
        stage: "generation",
        status: "fail",
        performedBy: "hazify",
        bundleId: null,
        inspectionId: normalizedInput.inspectionId,
        bundle: null,
        generationBasis,
        errors: [
          createIssue({
            code: "inspection_quality_insufficient",
            stage: "generation",
            severity: "error",
            blocking: true,
            source: "hazify",
            message: "Inspectie-artifact staat niet in pass-status; generatie is geblokkeerd.",
          }),
        ],
        warnings: [],
        nextRecommendedTool: "none",
      };
    }

    if (!generationBasis.generationReady) {
      return {
        action: "generate_shopify_section_bundle",
        stage: "generation",
        status: "fail",
        performedBy: "hazify",
        bundleId: null,
        inspectionId: normalizedInput.inspectionId,
        bundle: null,
        generationBasis,
        errors: [
          createIssue({
            code: "inspection_quality_insufficient",
            stage: "generation",
            severity: "error",
            blocking: true,
            source: "hazify",
            message: "Inspectie-artifact bevat onvoldoende betrouwbare data; generatie is geblokkeerd.",
          }),
        ],
        warnings: [],
        nextRecommendedTool: "none",
      };
    }

    const warnings = [];
    if (generationBasis.mode === "semantic-only") {
      warnings.push(
        createIssue({
          code: "inspection_visual_unavailable",
          stage: "generation",
          severity: "warn",
          blocking: false,
          source: "hazify",
          message: "Generatie draait in semantic-only modus omdat browser captures ontbreken of onvolledig zijn.",
        })
      );
    }

    if (generationBasis.mode === "low-confidence-fallback") {
      warnings.push(
        createIssue({
          code: "generation_fallback_mode",
          stage: "generation",
          severity: "warn",
          blocking: false,
          source: "hazify",
          message: "Generatie draait in low-confidence fallback modus; resultaat vereist extra handmatige review.",
        })
      );
    }

    const extracted = inspection.payload?.extracted || {};
    const textCandidates = take(extracted.textCandidates, normalizedInput.maxBlocks, ["Generated section"]);
    const imageCandidates = take(extracted.imageCandidates, normalizedInput.maxBlocks, []);

    let sectionHandle = normalizedInput.sectionHandle || "";
    if (!sectionHandle) {
      const suggested = textCandidates[0] || inspection.payload?.reference?.normalizedUrl || "generated-section";
      sectionHandle = slugifyFallback(suggested);
    }

    try {
      sectionHandle = normalizeSectionHandle(sectionHandle);
    } catch (_error) {
      sectionHandle = slugifyFallback(sectionHandle);
    }

    const sectionName =
      normalizedInput.sectionName ||
      sectionHandle
        .split(/[-_]+/g)
        .filter(Boolean)
        .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
        .join(" ");

    const generated = buildSectionLiquid({
      sectionHandle,
      sectionName,
      textCandidates,
      imageCandidates,
    });

    const bundle = {
      sectionHandle,
      files: [
        {
          path: `sections/${sectionHandle}.liquid`,
          contentType: "text/liquid",
          content: generated.liquid,
        },
      ],
      schemaSummary: generated.schemaSummary,
      suggestedTemplateKey: normalizedInput.templateHint || "templates/index.json",
    };

    const now = isoNow();
    const bundleId = generateArtifactId("bundle");
    const record = {
      artifactId: bundleId,
      tenantId,
      type: "bundle",
      status: warnings.length ? "partial" : "pass",
      parentIds: [normalizedInput.inspectionId],
      payload: {
        inspectionId: normalizedInput.inspectionId,
        bundle,
        generationHints: normalizedInput.generationHints || {},
        generationBasis,
        issues: warnings,
      },
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      expiresAt: expiresAtIso({ type: "bundle", ttlConfig: runtime.ttlConfig }),
      version: "section-workflow-v1",
    };

    await runtime.artifactStore.upsert(record);

    return {
      action: "generate_shopify_section_bundle",
      stage: "generation",
      status: "pass",
      performedBy: "hazify",
      bundleId,
      inspectionId: normalizedInput.inspectionId,
      bundle,
      generationBasis,
      errors: [],
      warnings,
      nextRecommendedTool: "validate-shopify-section-bundle",
    };
  } catch (error) {
    const normalizedCode =
      String(error?.code || "").trim().toLowerCase() === "artifact_quota_exceeded"
        ? "artifact_quota_exceeded"
        : "generation_failed";
    const issue = normalizeUnknownError({
      stage: "generation",
      source: "hazify",
      error,
      code: normalizedCode,
    });
    const { errors, warnings } = toBlockingAndWarnings([issue]);

    return {
      action: "generate_shopify_section_bundle",
      stage: "generation",
      status: "fail",
      performedBy: "hazify",
      bundleId: null,
      inspectionId: normalizedInput.inspectionId,
      bundle: null,
      generationBasis: {
        mode: "blocked",
        visualReady: false,
        semanticReady: false,
        generationReady: false,
        fallback: false,
      },
      errors,
      warnings,
      nextRecommendedTool: "none",
    };
  }
};
