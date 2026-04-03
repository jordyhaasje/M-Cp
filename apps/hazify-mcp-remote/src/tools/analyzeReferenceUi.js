import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchWithSafeRedirects } from "../lib/urlSecurity.js";

export const toolName = "analyze-reference-ui";
export const description =
  "Fetch and analyze an external reference URL as compact DOM guidance for Shopify section generation. The tool strips heavy tags, preserves structural IDs/classes and inline SVG markup, returns token-efficient Pug-like markup, adds a structured referenceSpec, and returns an actionable sectionPlan so LLMs can go directly into draft-theme-artifact. Image inputs are treated as hints only unless a future multimodal stage exists.";

const ReferenceInputSchema = z
  .object({
    url: z.string().url().optional().describe("De URL van de website om in te lezen."),
    cssSelector: z
      .string()
      .optional()
      .describe(
        "Optioneel: Een specifieke CSS-selector (bijv. 'footer', '#header', '.product-details') om de parse scope in te perken. Verlaagt tokenkosten significant."
      ),
    imageUrls: z
      .array(z.string().url())
      .max(8)
      .optional()
      .describe("Optionele screenshot- of referentieafbeeldingen. Deze werken momenteel als visuele hint, niet als zelfstandige bron."),
  })
  .superRefine((input, ctx) => {
    if (!input.url && (!Array.isArray(input.imageUrls) || input.imageUrls.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Geef minimaal een url of imageUrls op.",
      });
    }
  });

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function truncate(value, length = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, length);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function generatePugLikeMarkdown(node, $) {
  function walk(currentNode, depth) {
    if (currentNode.type === "text") {
      const text = $(currentNode).text().trim();
      if (!text) {
        return null;
      }
      return `${"  ".repeat(depth)}| ${text.replace(/\s+/g, " ")}`;
    }

    if (currentNode.type !== "tag") {
      return null;
    }

    const element = $(currentNode);
    const tag = String(element.prop("tagName") || "").toLowerCase();
    const idStr = element.attr("id") ? `#${element.attr("id")}` : "";
    const classNames = (element.attr("class") || "").split(/\s+/).filter(Boolean).join(".");
    const classStr = classNames ? `.${classNames}` : "";
    const attrs = [];

    const href = element.attr("href");
    if (href && !href.startsWith("javascript:") && !href.startsWith("data:")) {
      attrs.push(`href="${href.slice(0, 120)}"`);
    }

    const src = element.attr("src");
    if (src && !src.startsWith("data:")) {
      attrs.push(`src="${src.slice(0, 120)}"`);
    }

    const type = element.attr("type");
    if (type) {
      attrs.push(`type="${type}"`);
    }

    const attrStr = attrs.length ? `(${attrs.join(", ")})` : "";
    const line = `${"  ".repeat(depth)}${tag}${idStr}${classStr}${attrStr}`;

    const childLines = element
      .contents()
      .toArray()
      .map((child) => walk(child, depth + 1))
      .filter(Boolean);

    if (!childLines.length) {
      return line;
    }

    return [line, ...childLines].join("\n");
  }

  return walk(node, 0) || "";
}

function summarizeDomNode(node, $, depth = 0, maxDepth = 3, nodeBudget = { remaining: 80 }) {
  if (!node || nodeBudget.remaining <= 0) {
    return null;
  }
  nodeBudget.remaining -= 1;

  if (node.type === "text") {
    const text = truncate($(node).text(), 120);
    return text ? { type: "text", text } : null;
  }

  if (node.type !== "tag") {
    return null;
  }

  const element = $(node);
  const summary = {
    type: "element",
    tag: String(element.prop("tagName") || "").toLowerCase(),
    id: element.attr("id") || null,
    classes: (element.attr("class") || "").split(/\s+/).filter(Boolean).slice(0, 8),
  };

  const text = truncate(element.text(), 120);
  if (text) {
    summary.text = text;
  }

  if (depth >= maxDepth) {
    return summary;
  }

  const children = element
    .contents()
    .toArray()
    .map((child) => summarizeDomNode(child, $, depth + 1, maxDepth, nodeBudget))
    .filter(Boolean);

  if (children.length) {
    summary.children = children;
  }

  return summary;
}

function extractStyleSignals(rawCss) {
  const css = String(rawCss || "");
  const colorMatches = css.match(/#(?:[0-9a-fA-F]{3,8})\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g) || [];
  const breakpoints = Array.from(
    css.matchAll(/@media[^{]*(?:max|min)-width\s*:\s*(\d+)px/gi),
    (match) => Number(match[1])
  ).filter(Number.isFinite);

  const typography = Array.from(
    css.matchAll(/font-(?:size|weight|family|style|line-height)\s*:\s*([^;}{]+)/gi),
    (match) => truncate(match[1], 80)
  );
  const spacing = Array.from(
    css.matchAll(/(?:padding|margin|gap)\s*:\s*([^;}{]+)/gi),
    (match) => truncate(match[1], 80)
  );
  const radii = Array.from(
    css.matchAll(/border-radius\s*:\s*([^;}{]+)/gi),
    (match) => truncate(match[1], 80)
  );
  const shadows = Array.from(
    css.matchAll(/box-shadow\s*:\s*([^;}{]+)/gi),
    (match) => truncate(match[1], 120)
  );

  return {
    breakpointHints: uniqueStrings(breakpoints.map(String)).map(Number),
    colorTokens: uniqueStrings(colorMatches).slice(0, 20),
    typographySignals: uniqueStrings(typography).slice(0, 20),
    spacingSignals: uniqueStrings(spacing).slice(0, 20),
    radiusSignals: uniqueStrings(radii).slice(0, 20),
    shadowSignals: uniqueStrings(shadows).slice(0, 20),
  };
}

function buildReferenceSpec({
  url,
  cssSelector,
  imageUrls,
  markup,
  $,
  rootNode,
  stylesheetUrls,
  inlineStyles,
  sourcesNote,
}) {
  const classes = uniqueStrings(
    $(rootNode)
      .find("[class]")
      .toArray()
      .flatMap((node) => ($(node).attr("class") || "").split(/\s+/).filter(Boolean))
  );
  const ids = uniqueStrings(
    $(rootNode)
      .find("[id]")
      .toArray()
      .map((node) => $(node).attr("id"))
  );
  const imageSources = uniqueStrings(
    $(rootNode)
      .find("img[src]")
      .toArray()
      .map((node) => $(node).attr("src"))
      .filter((src) => src && !src.startsWith("data:"))
  );
  const linkTargets = uniqueStrings(
    $(rootNode)
      .find("a[href]")
      .toArray()
      .map((node) => $(node).attr("href"))
      .filter((href) => href && !href.startsWith("javascript:"))
  );

  const styleSignals = extractStyleSignals(inlineStyles.join("\n"));
  const fidelityGaps = [];
  if (!stylesheetUrls.length) {
    fidelityGaps.push("No external stylesheets were captured in the lightweight analysis.");
  }
  if (imageUrls.length > 0) {
    fidelityGaps.push(
      "Image inputs were stored as supplemental hints only. The current pipeline still needs a URL for reliable section reconstruction."
    );
  }
  fidelityGaps.push(...sourcesNote);

  return {
    version: 1,
    sources: [
      ...(url ? [{ type: "url", url }] : []),
      ...imageUrls.map((imageUrl) => ({ type: "image", url: imageUrl })),
    ],
    selector: cssSelector || "body",
    structure: {
      rootTag: String($(rootNode).prop("tagName") || "root").toLowerCase(),
      nodeTree: summarizeDomNode(rootNode, $),
      classNames: classes.slice(0, 40),
      ids: ids.slice(0, 30),
      images: imageSources.slice(0, 20),
      links: linkTargets.slice(0, 20),
      svgCount: $(rootNode).find("svg").length,
      textPreview: truncate($(rootNode).text(), 240),
    },
    markupPreview: truncate(markup, 1000),
    visualSignals: {
      stylesheetUrls: stylesheetUrls.slice(0, 12),
      ...styleSignals,
    },
    fidelityGaps,
  };
}

function inferSectionSlug({ url, cssSelector, $, rootNode }) {
  const candidates = [];

  if (url) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        candidates.push(segments[segments.length - 1]);
      }
    } catch {
      // noop
    }
  }

  if (cssSelector) {
    candidates.push(cssSelector.replace(/^[.#]/, ""));
  }

  if ($ && rootNode) {
    const headingText = $(rootNode)
      .find("h1, h2, h3")
      .first()
      .text()
      .trim();
    if (headingText) {
      candidates.push(headingText);
    }
  }

  for (const candidate of candidates) {
    const slug = slugify(candidate);
    if (slug) {
      return slug;
    }
  }

  return "reference-section";
}

function detectBlockRecommendations($, rootNode) {
  if (!$ || !rootNode) {
    return [];
  }

  const recommendations = [];
  const listItemCount = $(rootNode).find("ul li, ol li").length;
  const tableRowCount = $(rootNode).find("table tr").length;
  const cardLikeCount = $(rootNode).find("[class*='card'], [class*='tile'], [class*='item']").length;
  const buttonCount = $(rootNode).find("a[href], button").length;

  if (listItemCount >= 2) {
    recommendations.push({
      type: "list_item",
      reason: "Reference contains repeated bullet/list content that should stay merchant-editable.",
      suggestedSchema: ["text", "richtext", "image_picker"],
    });
  }

  if (tableRowCount >= 2 || $(rootNode).find("table, [class*='comparison']").length > 0) {
    recommendations.push({
      type: "comparison_row",
      reason: "Reference contains repeated comparison rows or table-like structures.",
      suggestedSchema: ["text", "checkbox", "text"],
    });
  }

  if (cardLikeCount >= 2) {
    recommendations.push({
      type: "card",
      reason: "Reference appears to use repeated card-style elements.",
      suggestedSchema: ["text", "richtext", "image_picker", "url"],
    });
  }

  if (buttonCount >= 1) {
    recommendations.push({
      type: "cta",
      reason: "Reference includes a clear call-to-action that should remain editable.",
      suggestedSchema: ["text", "url"],
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      type: "content_item",
      reason: "Use a simple repeating block only if multiple similar content items are needed.",
      suggestedSchema: ["text", "richtext", "image_picker"],
    });
  }

  return recommendations.slice(0, 4);
}

function buildRecommendedSchemaSettings({ $, rootNode, referenceSpec }) {
  const settings = [
    { id: "heading", type: "text", reason: "Primary headline copy." },
    { id: "body_text", type: "richtext", reason: "Supporting descriptive copy." },
    { id: "section_background", type: "color", reason: "Section background color." },
    { id: "text_color", type: "color", reason: "Primary text color." },
    { id: "accent_color", type: "color", reason: "Accent color for highlights, icons, or markers." },
    { id: "section_padding_top", type: "range", reason: "Top spacing control." },
    { id: "section_padding_bottom", type: "range", reason: "Bottom spacing control." },
    { id: "card_radius", type: "range", reason: "Rounded corners for the main card or frame." },
  ];

  if ($ && rootNode && $(rootNode).find("img").length > 0) {
    settings.push({
      id: "feature_image",
      type: "image_picker",
      reason: "Reference includes imagery or a brand mark.",
    });
  }

  if ($ && rootNode && $(rootNode).find("a[href], button").length > 0) {
    settings.push(
      { id: "cta_label", type: "text", reason: "Button label or CTA copy." },
      { id: "cta_link", type: "url", reason: "CTA destination." }
    );
  }

  if (referenceSpec?.visualSignals?.colorTokens?.length) {
    settings.push({
      id: "border_color",
      type: "color",
      reason: "Useful when the reference contains explicit borders or separators.",
    });
  }

  return settings;
}

function buildGenerationHints({ readyForDraft, primaryFileKey, hasImageHints }) {
  const hints = [
    "Nieuwe sections uit een reference gebruiken standaard alleen analyze-reference-ui gevolgd door draft-theme-artifact.",
    `Standaard file policy: maak alleen \`${primaryFileKey}\` tenzij hergebruik of vaste locale copy extra files echt vereist.`,
    "Pas geen templates/*.json of config/*.json aan; merchants plaatsen de section zelf via de Theme Editor.",
    "Gebruik blocks alleen voor herhaalde content en voeg altijd presets toe.",
    "Gebruik image_url en image_tag voor Shopify media.",
    "Gebruik geen Liquid binnen {% stylesheet %} of {% javascript %}; gebruik <style> of CSS variables in markup als section.id-scoping nodig is.",
  ];

  if (!readyForDraft) {
    hints.unshift("Image-only references zijn nog niet genoeg om betrouwbaar een section te genereren. Vraag om een reference URL.");
  } else if (hasImageHints) {
    hints.push("Gebruik de meegegeven image hints alleen als aanvullende visuele nuance naast de URL-analyse.");
  }

  return hints;
}

function buildSectionPlan({
  url,
  cssSelector,
  imageUrls,
  $,
  rootNode,
  referenceSpec,
  readyForDraft,
  blockedReason = null,
}) {
  const slug = inferSectionSlug({ url, cssSelector, $, rootNode });
  const primaryFileKey = `sections/${slug}.liquid`;
  const blockRecommendations = readyForDraft ? detectBlockRecommendations($, rootNode) : [];
  const recommendedSchemaSettings = buildRecommendedSchemaSettings({ $, rootNode, referenceSpec });
  const fidelityRisks = uniqueStrings(referenceSpec?.fidelityGaps || []);

  return {
    status: readyForDraft ? "ready_for_draft" : "blocked",
    recommendedFileStrategy: "single-section-file",
    recommendedPrimaryFile: primaryFileKey,
    suggestedFiles: [
      {
        key: primaryFileKey,
        required: true,
        role: "section",
        reason: "Default Shopify-conform output for a new reference-based section.",
      },
    ],
    additionalFilesNeeded: [],
    blockRecommendations,
    recommendedSchemaSettings,
    fidelityRisks,
    readyForDraft,
    blockedReason,
    nextTool: readyForDraft ? "draft-theme-artifact" : null,
    notes: [
      "Gebruik blocks alleen voor echt herhaalde content.",
      "Voeg snippets/locales alleen toe als daar een concrete inhoudelijke reden voor is.",
      imageUrls.length > 0
        ? "Meegeleverde afbeeldingen zijn hints; de reference URL blijft de primaire bron."
        : "Er zijn geen aanvullende image hints meegeleverd.",
    ],
  };
}

function buildNextAction({ readyForDraft, url, cssSelector, imageUrls, sectionPlan, errorCode }) {
  if (!readyForDraft) {
    return {
      kind: "user_input_required",
      tool: null,
      readyForDraft: false,
      reason:
        errorCode === "image_only_not_supported"
          ? "Image-only analyse is nog niet voldoende voor betrouwbare section cloning."
          : "Er is aanvullende input nodig voordat drafting logisch is.",
      requestedInput: ["url"],
      guidance: "Vraag de gebruiker om een reference URL. Een afbeelding mag als extra hint blijven meegaan.",
    };
  }

  return {
    kind: "call_tool",
    tool: "draft-theme-artifact",
    readyForDraft: true,
    reason: "De reference-analyse is voldoende om direct een preview-safe section draft te maken.",
    minimalArguments: {
      themeRole: "development",
      referenceInput: {
        url,
        ...(cssSelector ? { cssSelector } : {}),
        ...(imageUrls.length ? { imageUrls } : {}),
      },
      referenceSpec: {
        version: sectionPlan?.fidelityRisks?.length ? 1 : 1,
      },
      files: [
        {
          key: sectionPlan.recommendedPrimaryFile,
          value: "<generate Shopify section code here>",
        },
      ],
    },
  };
}

function classifyAnalyzeError(error) {
  const message = String(error?.message || error || "");
  if (/selector/i.test(message) && /niet vinden/i.test(message)) {
    return {
      errorCode: "selector_not_found",
      retryable: true,
      nextAction: {
        kind: "adjust_input",
        tool: "analyze-reference-ui",
        readyForDraft: false,
        reason: "De selector matchte niet op de opgehaalde pagina.",
        guidance: "Probeer de analyse opnieuw zonder cssSelector of met een bredere selector.",
      },
    };
  }

  if (/aborted|timeout/i.test(message)) {
    return {
      errorCode: "reference_fetch_timeout",
      retryable: true,
      nextAction: {
        kind: "retry",
        tool: "analyze-reference-ui",
        readyForDraft: false,
        reason: "De reference fetch liep tegen een timeout aan.",
        guidance: "Probeer opnieuw of beperk de scope met cssSelector.",
      },
    };
  }

  return {
    errorCode: "reference_fetch_failed",
    retryable: true,
    nextAction: {
      kind: "retry",
      tool: "analyze-reference-ui",
      readyForDraft: false,
      reason: "De reference kon niet worden opgehaald of geparsed.",
      guidance: "Controleer de URL en probeer opnieuw.",
    },
  };
}

function bucketLatency(elapsedMs) {
  if (elapsedMs < 300) {
    return "<300ms";
  }
  if (elapsedMs < 1000) {
    return "300ms-1s";
  }
  if (elapsedMs < 3000) {
    return "1s-3s";
  }
  return "3s+";
}

function logReferenceAnalysis(summary) {
  console.info(
    `[analyze-reference-ui] mode=${summary.analysisMode} usedVisualWorker=${summary.usedVisualWorker} fallback=${summary.workerFallbackReason || "none"} latency=${summary.latencyBucket}`
  );
}

async function fetchHtmlWithGuards(url, context = {}) {
  if (typeof context.fetchReferenceHtml === "function") {
    return context.fetchReferenceHtml(url);
  }

  const response = await fetchWithSafeRedirects(url, {
    timeoutMs: Number(process.env.HAZIFY_VISUAL_ANALYSIS_TIMEOUT_MS || 12000),
    headers: {
      "User-Agent": "HazifyReferenceAnalyzer/1.0 (+https://hazify.dev)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch faalde met HTTP status ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function requestVisualWorker(payload, context = {}) {
  if (typeof context.visualWorkerAnalyze === "function") {
    return {
      attempted: true,
      source: "context",
      result: await context.visualWorkerAnalyze(payload),
    };
  }

  const workerEnabled = String(process.env.HAZIFY_VISUAL_ANALYSIS_ENABLED || "false").toLowerCase() === "true";
  const workerUrl = String(process.env.HAZIFY_VISUAL_WORKER_URL || "").trim();
  if (!workerEnabled) {
    return {
      attempted: false,
      source: "feature-flag-disabled",
      result: null,
    };
  }
  if (!workerUrl) {
    return {
      attempted: false,
      source: "missing-worker-url",
      result: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.HAZIFY_VISUAL_ANALYSIS_TIMEOUT_MS || 12000)
  );
  try {
    const response = await fetch(new URL("/v1/reference/analyze", workerUrl).toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Visual worker returned ${response.status}`);
    }
    return {
      attempted: true,
      source: "remote",
      result: await response.json(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const analyzeReferenceUi = {
  name: toolName,
  description,
  schema: ReferenceInputSchema,
  execute: async (args, context = {}) => {
    const startedAt = Date.now();
    const { url, cssSelector, imageUrls = [] } = args;

    try {
      if (!url) {
        const referenceSpec = {
          version: 1,
          sources: imageUrls.map((imageUrl) => ({ type: "image", url: imageUrl })),
          selector: cssSelector || null,
          structure: null,
          markupPreview: "",
          visualSignals: {
            stylesheetUrls: [],
            breakpointHints: [],
            colorTokens: [],
            typographySignals: [],
            spacingSignals: [],
            radiusSignals: [],
            shadowSignals: [],
          },
          fidelityGaps: [
            "No URL source was provided, so DOM extraction was skipped.",
            "Image-only section cloning is not supported yet. Image inputs are stored as hints only.",
          ],
        };
        const sectionPlan = buildSectionPlan({
          url: null,
          cssSelector,
          imageUrls,
          $: null,
          rootNode: null,
          referenceSpec,
          readyForDraft: false,
          blockedReason: "image_only_not_supported",
        });
        const nextAction = buildNextAction({
          readyForDraft: false,
          url: null,
          cssSelector,
          imageUrls,
          sectionPlan,
          errorCode: "image_only_not_supported",
        });

        const result = {
          success: true,
          url: null,
          selector: cssSelector || null,
          contentLength: 0,
          markup: "Image hint opgeslagen, maar een reference URL is nog nodig voor betrouwbare section cloning.",
          referenceSpec,
          analysisMode: "image-hint-only",
          fidelityWarnings: referenceSpec.fidelityGaps,
          sources: referenceSpec.sources,
          sectionPlan,
          errorCode: "image_only_not_supported",
          retryable: false,
          nextAction,
          suggestedFiles: sectionPlan.suggestedFiles,
          requiredInputs: ["url"],
          generationHints: buildGenerationHints({
            readyForDraft: false,
            primaryFileKey: sectionPlan.recommendedPrimaryFile,
            hasImageHints: imageUrls.length > 0,
          }),
          usedVisualWorker: false,
          fidelityUpgradeApplied: false,
          workerWarnings: [],
        };

        logReferenceAnalysis({
          analysisMode: result.analysisMode,
          usedVisualWorker: false,
          workerFallbackReason: "no-url",
          latencyBucket: bucketLatency(Date.now() - startedAt),
        });
        return result;
      }

      const html = await fetchHtmlWithGuards(url, context);
      const $ = cheerio.load(html);

      const stylesheetUrls = uniqueStrings(
        $("link[rel='stylesheet'][href]")
          .toArray()
          .map((node) => {
            const href = $(node).attr("href");
            if (!href) {
              return null;
            }
            try {
              return new URL(href, url).toString();
            } catch {
              return null;
            }
          })
      );
      const inlineStyles = $("style")
        .toArray()
        .map((node) => $(node).html() || "");

      $("script, style, iframe, noscript, link, meta, head").remove();
      $("img[src^='data:']").remove();

      let rootNode;
      if (cssSelector) {
        rootNode = $(cssSelector).first();
        if (!rootNode.length) {
          throw new Error(`Kon selector '${cssSelector}' niet vinden in de opgehaalde pagina.`);
        }
      } else {
        rootNode = $("body").first();
        if (!rootNode.length) {
          rootNode = $.root();
        }
      }

      const markup = generatePugLikeMarkdown(rootNode[0], $) || "Geen valide UI content om uit te parsen.";
      const basicReferenceSpec = buildReferenceSpec({
        url,
        cssSelector,
        imageUrls,
        markup,
        $,
        rootNode: rootNode[0],
        stylesheetUrls,
        inlineStyles,
        sourcesNote: ["Lightweight analysis does not execute browser layout or JavaScript."],
      });

      let referenceSpec = basicReferenceSpec;
      let analysisMode = "cheerio";
      const fidelityWarnings = [...basicReferenceSpec.fidelityGaps];
      const workerWarnings = [];
      let usedVisualWorker = false;
      let fidelityUpgradeApplied = false;
      let workerFallbackReason = null;

      try {
        const workerAttempt = await requestVisualWorker(
          {
            url,
            cssSelector,
            imageUrls,
            basicReferenceSpec,
          },
          context
        );

        if (workerAttempt.attempted && workerAttempt.result?.success && workerAttempt.result.referenceSpec) {
          referenceSpec = workerAttempt.result.referenceSpec;
          analysisMode = "hybrid";
          usedVisualWorker = true;
          fidelityUpgradeApplied = true;
          if (Array.isArray(workerAttempt.result.fidelityWarnings)) {
            fidelityWarnings.push(...workerAttempt.result.fidelityWarnings);
          }
          if (Array.isArray(workerAttempt.result.workerWarnings)) {
            workerWarnings.push(...workerAttempt.result.workerWarnings);
          }
        } else if (workerAttempt.attempted && workerAttempt.result?.success === false) {
          workerFallbackReason = workerAttempt.result.errorCode || "worker-returned-unsuccessful-result";
          analysisMode = "cheerio-fallback";
          workerWarnings.push(workerAttempt.result.error || "Visual worker returned an unsuccessful result.");
        } else if (!workerAttempt.attempted) {
          workerFallbackReason = workerAttempt.source;
          workerWarnings.push(
            workerAttempt.source === "feature-flag-disabled"
              ? "Visual worker is disabled; using URL-first Cheerio analysis."
              : "Visual worker URL ontbreekt; using URL-first Cheerio analysis."
          );
        }
      } catch (workerError) {
        fidelityWarnings.push(`Visual worker fallback actief: ${workerError.message}`);
        workerWarnings.push(workerError.message);
        workerFallbackReason = "worker-error";
        analysisMode = "cheerio-fallback";
      }

      const sectionPlan = buildSectionPlan({
        url,
        cssSelector,
        imageUrls,
        $,
        rootNode: rootNode[0],
        referenceSpec,
        readyForDraft: true,
      });
      const nextAction = buildNextAction({
        readyForDraft: true,
        url,
        cssSelector,
        imageUrls,
        sectionPlan,
        errorCode: null,
      });

      const result = {
        success: true,
        url,
        selector: cssSelector || "body",
        contentLength: markup.length,
        markup,
        referenceSpec,
        analysisMode,
        fidelityWarnings: uniqueStrings(fidelityWarnings),
        sources: referenceSpec.sources || [],
        sectionPlan,
        errorCode: null,
        retryable: false,
        nextAction,
        suggestedFiles: sectionPlan.suggestedFiles,
        requiredInputs: [],
        generationHints: buildGenerationHints({
          readyForDraft: true,
          primaryFileKey: sectionPlan.recommendedPrimaryFile,
          hasImageHints: imageUrls.length > 0,
        }),
        usedVisualWorker,
        fidelityUpgradeApplied,
        workerWarnings: uniqueStrings(workerWarnings),
      };

      logReferenceAnalysis({
        analysisMode: result.analysisMode,
        usedVisualWorker,
        workerFallbackReason,
        latencyBucket: bucketLatency(Date.now() - startedAt),
      });

      return result;
    } catch (error) {
      const classified = classifyAnalyzeError(error);
      const failedResult = {
        success: false,
        error: `Kon referentie UI niet inlezen of parsen: ${error.message}`,
        errorCode: classified.errorCode,
        retryable: classified.retryable,
        nextAction: classified.nextAction,
        requiredInputs: [],
        suggestedFiles: [],
        generationHints: [],
        usedVisualWorker: false,
        fidelityUpgradeApplied: false,
        workerWarnings: [],
      };

      logReferenceAnalysis({
        analysisMode: "failed",
        usedVisualWorker: false,
        workerFallbackReason: classified.errorCode,
        latencyBucket: bucketLatency(Date.now() - startedAt),
      });

      return failedResult;
    }
  },
};
