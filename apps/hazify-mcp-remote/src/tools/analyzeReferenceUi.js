import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchWithSafeRedirects } from "../lib/urlSecurity.js";

export const toolName = "analyze-reference-ui";
export const description =
  "Fetch and analyze an external reference URL as compact DOM guidance for Shopify section generation. The tool strips heavy tags, preserves structural IDs/classes and inline SVG markup, returns token-efficient Pug-like markup, and adds a structured referenceSpec. When visual analysis is enabled it can enrich the result through the visual worker.";

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
      .describe("Optionele screenshot- of referentieafbeeldingen voor toekomstige visual enrichment."),
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

function buildReferenceSpec({ url, cssSelector, imageUrls, markup, $, rootNode, stylesheetUrls, inlineStyles, sourcesNote }) {
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
    fidelityGaps.push("Image inputs were registered, but image-only visual understanding requires the optional visual worker.");
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
    return context.visualWorkerAnalyze(payload);
  }

  const workerEnabled = String(process.env.HAZIFY_VISUAL_ANALYSIS_ENABLED || "false").toLowerCase() === "true";
  const workerUrl = String(process.env.HAZIFY_VISUAL_WORKER_URL || "").trim();
  if (!workerEnabled || !workerUrl) {
    return null;
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
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export const analyzeReferenceUi = {
  name: toolName,
  description,
  schema: ReferenceInputSchema,
  execute: async (args, context = {}) => {
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
            "Image-only reference analysis needs the optional visual worker or an external multimodal stage.",
          ],
        };
        return {
          success: true,
          url: null,
          selector: cssSelector || null,
          contentLength: 0,
          markup: "Geen HTML-bron beschikbaar; alleen image referenties geregistreerd.",
          referenceSpec,
          analysisMode: "image-only",
          fidelityWarnings: referenceSpec.fidelityGaps,
          sources: referenceSpec.sources,
        };
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
        sourcesNote: [
          "Lightweight analysis does not execute browser layout or JavaScript.",
        ],
      });

      let referenceSpec = basicReferenceSpec;
      let analysisMode = "cheerio";
      const fidelityWarnings = [...basicReferenceSpec.fidelityGaps];

      try {
        const workerResult = await requestVisualWorker({
          url,
          cssSelector,
          imageUrls,
          basicReferenceSpec,
        }, context);

        if (workerResult?.success && workerResult.referenceSpec) {
          referenceSpec = workerResult.referenceSpec;
          analysisMode = "hybrid";
          if (Array.isArray(workerResult.fidelityWarnings)) {
            fidelityWarnings.push(...workerResult.fidelityWarnings);
          }
        }
      } catch (workerError) {
        fidelityWarnings.push(`Visual worker fallback actief: ${workerError.message}`);
        analysisMode = "cheerio-fallback";
      }

      return {
        success: true,
        url,
        selector: cssSelector || "body",
        contentLength: markup.length,
        markup,
        referenceSpec,
        analysisMode,
        fidelityWarnings: uniqueStrings(fidelityWarnings),
        sources: referenceSpec.sources || [],
      };
    } catch (error) {
      return {
        success: false,
        error: `Kon referentie UI niet inlezen of parsen: ${error.message}`,
      };
    }
  },
};
