import * as cheerio from "cheerio";
import { fetchWithSafeRedirects } from "@hazify/mcp-common";

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function truncate(value, length = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, length);
}

function parseDeclarations(body) {
  return body
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator === -1) {
        return null;
      }
      return {
        property: entry.slice(0, separator).trim().toLowerCase(),
        value: entry.slice(separator + 1).trim(),
      };
    })
    .filter(Boolean);
}

function extractCssSignals(cssText) {
  const css = String(cssText || "");
  const colors = css.match(/#(?:[0-9a-fA-F]{3,8})\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g) || [];
  const breakpoints = Array.from(
    css.matchAll(/@media[^{]*(?:max|min)-width\s*:\s*(\d+)px/gi),
    (match) => Number(match[1])
  ).filter(Number.isFinite);
  const spacing = Array.from(
    css.matchAll(/(?:padding|margin|gap)\s*:\s*([^;}{]+)/gi),
    (match) => truncate(match[1], 80)
  );
  const typography = Array.from(
    css.matchAll(/font-(?:size|weight|family|style|line-height)\s*:\s*([^;}{]+)/gi),
    (match) => truncate(match[1], 80)
  );
  const shadows = Array.from(
    css.matchAll(/box-shadow\s*:\s*([^;}{]+)/gi),
    (match) => truncate(match[1], 120)
  );
  const radii = Array.from(
    css.matchAll(/border-radius\s*:\s*([^;}{]+)/gi),
    (match) => truncate(match[1], 80)
  );

  return {
    breakpointHints: uniqueStrings(breakpoints.map(String)).map(Number),
    colorTokens: uniqueStrings(colors).slice(0, 30),
    spacingSignals: uniqueStrings(spacing).slice(0, 30),
    typographySignals: uniqueStrings(typography).slice(0, 30),
    shadowSignals: uniqueStrings(shadows).slice(0, 20),
    radiusSignals: uniqueStrings(radii).slice(0, 20),
  };
}

function parseSimpleCssRules(cssText, media = null) {
  const rules = [];
  const css = String(cssText || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const regex = /([^{}]+)\{([^{}]+)\}/g;
  let match = regex.exec(css);
  while (match) {
    const selectorList = match[1]
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);
    const declarations = parseDeclarations(match[2]);
    if (declarations.length) {
      for (const selector of selectorList) {
        rules.push({ selector, declarations, media });
      }
    }
    match = regex.exec(css);
  }
  return rules;
}

function collectMediaRules(cssText) {
  const mediaRules = [];
  const mediaRegex = /@media([^{]+)\{([\s\S]*?)\}\s*/gi;
  let match = mediaRegex.exec(String(cssText || ""));
  while (match) {
    mediaRules.push({
      condition: truncate(match[1], 120),
      rules: parseSimpleCssRules(match[2], truncate(match[1], 120)),
    });
    match = mediaRegex.exec(String(cssText || ""));
  }
  return mediaRules;
}

function selectorMatches(node, selector) {
  if (!node || !selector) {
    return false;
  }
  const trimmed = selector.trim();
  if (!trimmed || /[\s>:+~\[]/.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith(".")) {
    return node.classes.includes(trimmed.slice(1));
  }
  if (trimmed.startsWith("#")) {
    return node.id === trimmed.slice(1);
  }
  return node.tag === trimmed.toLowerCase();
}

function summarizeInterestingNodes(rootNode, $, rules) {
  const nodes = [];
  $(rootNode)
    .find("*")
    .slice(0, 40)
    .each((_, element) => {
      const el = $(element);
      const node = {
        tag: String(el.prop("tagName") || "").toLowerCase(),
        id: el.attr("id") || null,
        classes: (el.attr("class") || "").split(/\s+/).filter(Boolean).slice(0, 8),
        text: truncate(el.text(), 120),
      };
      node.computedStyles = rules
        .filter((rule) => selectorMatches(node, rule.selector))
        .slice(0, 12)
        .map((rule) => ({
          selector: rule.selector,
          media: rule.media,
          declarations: rule.declarations.slice(0, 8),
        }));
      if (node.text || node.classes.length || node.id) {
        nodes.push(node);
      }
    });
  return nodes;
}

async function fetchText(url, context = {}) {
  if (typeof context.fetchText === "function") {
    return context.fetchText(url);
  }

  const response = await fetchWithSafeRedirects(url, {
    timeoutMs: Number(process.env.HAZIFY_VISUAL_ANALYSIS_TIMEOUT_MS || 12000),
    headers: {
      "User-Agent": "HazifyVisualWorker/1.0 (+https://hazify.dev)",
      Accept: "text/html,text/css,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchStylesheetTexts(stylesheetUrls, context = {}) {
  const sheets = [];
  const fidelityWarnings = [];
  for (const stylesheetUrl of stylesheetUrls.slice(0, 5)) {
    try {
      const content = await fetchText(stylesheetUrl, context);
      sheets.push({ url: stylesheetUrl, content: content.slice(0, 150000) });
    } catch (error) {
      fidelityWarnings.push(`Stylesheet kon niet worden opgehaald: ${stylesheetUrl} (${error.message})`);
    }
  }
  return { sheets, fidelityWarnings };
}

export async function analyzeReferencePayload(payload, context = {}) {
  const url = String(payload?.url || "").trim();
  const cssSelector = payload?.cssSelector ? String(payload.cssSelector).trim() : "";
  const imageUrls = Array.isArray(payload?.imageUrls) ? payload.imageUrls : [];
  const basicReferenceSpec = payload?.basicReferenceSpec || null;

  if (!url) {
    return {
      success: false,
      error: "url is verplicht voor visual analysis.",
    };
  }

  const html = await fetchText(url, context);
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

  const { sheets, fidelityWarnings } = await fetchStylesheetTexts(stylesheetUrls, context);
  const allCss = [...inlineStyles, ...sheets.map((sheet) => sheet.content)].join("\n");
  const visualSignals = extractCssSignals(allCss);
  const baseRules = parseSimpleCssRules(allCss);
  const mediaRules = collectMediaRules(allCss);

  $("script, style, iframe, noscript, link, meta, head").remove();
  $("img[src^='data:']").remove();

  let rootNode;
  if (cssSelector) {
    rootNode = $(cssSelector).first();
    if (!rootNode.length) {
      throw new Error(`Kon selector '${cssSelector}' niet vinden.`);
    }
  } else {
    rootNode = $("body").first();
    if (!rootNode.length) {
      rootNode = $.root();
    }
  }

  const referenceSpec = {
    ...(basicReferenceSpec && typeof basicReferenceSpec === "object" ? basicReferenceSpec : {}),
    version: 2,
    sources: [
      { type: "url", url },
      ...imageUrls.map((imageUrl) => ({ type: "image", url: imageUrl })),
    ],
    selector: cssSelector || "body",
    structure: {
      ...(basicReferenceSpec?.structure || {}),
      interestingNodes: summarizeInterestingNodes(rootNode[0], $, baseRules),
      svgCount: $(rootNode).find("svg").length,
      imageCount: $(rootNode).find("img").length,
    },
    visualSignals: {
      ...(basicReferenceSpec?.visualSignals || {}),
      stylesheetUrls,
      ...visualSignals,
      computedStyleCandidates: summarizeInterestingNodes(rootNode[0], $, baseRules).slice(0, 12),
      mediaRules: mediaRules.slice(0, 12),
    },
    fidelityGaps: uniqueStrings([
      ...(basicReferenceSpec?.fidelityGaps || []),
      ...fidelityWarnings,
      "Visual worker enriches CSS/style signals but does not execute a full layout engine.",
    ]),
  };

  return {
    success: true,
    referenceSpec,
    fidelityWarnings: referenceSpec.fidelityGaps,
  };
}
