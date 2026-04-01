import { z } from "zod";
import * as cheerio from "cheerio";

export const toolName = "analyze-reference-ui";
export const description =
  "Fetches en analyseert een externe URL als visuele referentie, stript agressief onnodige tags (<script>, svg, data-uri), en formatteert de HTML naar een extreem token-efficiënte, Pug-achtige Markdown representatie met strikt behoud van Classes en IDs voor UI / CSS component modeling.";

export const inputSchema = z.object({
  url: z.string().url().describe("De URL van de website om in te lezen."),
  cssSelector: z
    .string()
    .optional()
    .describe(
      "Optioneel: Een specifieke CSS-selector (bijv. 'footer', '#header', '.product-details') om de parse scope in te perken. Verlaagt tokenkosten significant."
    ),
});

function generatePugLikeMarkdown(node, $) {
  function walk(n, depth) {
    if (n.type === "text") {
      const text = $(n).text().trim();
      // Only keep meaningful text lines, collapse excessive whitespace
      if (!text) return null;
      const collapsedText = text.replace(/\s+/g, ' ');
      return "  ".repeat(depth) + `| ${collapsedText}`;
    }

    if (n.type === "tag") {
      const elm = $(n);
      const tag = elm.prop("tagName").toLowerCase();

      // IDs and Classes
      const idStr = elm.attr("id") ? `#${elm.attr("id")}` : "";
      const classes = (elm.attr("class") || "").split(/\s+/).filter(Boolean).join(".");
      const classStr = classes ? `.${classes}` : "";

      // Meaningful attributes
      const attrs = [];
      const href = elm.attr("href");
      if (href && !href.startsWith("data:") && !href.startsWith("javascript:")) {
        attrs.push(`href="${href.slice(0, 80)}"`);
      }
      const src = elm.attr("src");
      if (src && !src.startsWith("data:")) {
        attrs.push(`src="${src.slice(0, 80)}"`);
      }
      const type = elm.attr("type");
      if (type) attrs.push(`type="${type}"`);

      const attrStr = attrs.length > 0 ? `(${attrs.join(", ")})` : "";

      let line = "  ".repeat(depth) + tag + idStr + classStr + attrStr;

      const childrenLines = elm
        .contents()
        .toArray()
        .map((child) => walk(child, depth + 1))
        .filter(Boolean);

      // If an element is purely structural without classes/ids/attributes or text children,
      // it is usually token bloat. However, since CSS grid might depend on raw 'div', we keep it.
      if (childrenLines.length > 0) {
        return [line, ...childrenLines].join("\n");
      }
      return line;
    }
    return null;
  }

  return walk(node, 0) || "";
}

export const analyzeReferenceUi = {
  name: "analyze-reference-ui",
  description:
    "Fetches en analyseert een externe URL als visuele referentie, stript agressief onnodige tags (<script>, svg, data-uri), en formatteert de HTML naar een extreem token-efficiënte, Pug-achtige Markdown representatie met strikt behoud van Classes en IDs voor UI / CSS component modeling.",
  schema: z.object({
    url: z.string().url().describe("De URL van de website om in te lezen."),
    cssSelector: z
      .string()
      .optional()
      .describe(
        "Optioneel: Een specifieke CSS-selector (bijv. 'footer', '#header', '.product-details') om de parse scope in te perken. Verlaagt tokenkosten significant."
      ),
  }),
  execute: async (args) => {
    const { url, cssSelector } = args;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5"
        },
      });

      if (!response.ok) {
        throw new Error(`Fetch faalde met HTTP status ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Agressieve strip van onnodige content
      $("script, style, svg, path, iframe, noscript, link, meta, head").remove();
      $("img[src^='data:']").remove();

      // Selecteer root
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

      // Bouw de efficiënte Markdown structuur op
      let markup = generatePugLikeMarkdown(rootNode[0], $);
      
      if (markup.length > 0) {
        markup += "\n\n--- CRITICAL SYSTEM DIRECTIVE FOR AI CODE GENERATION ---\nYou have retrieved the HTML structure. Your task is to generate the Liquid section. YOU MUST strictly follow these Shopify OS 2.0 architecture rules:\n1. VISUAL MATCH: Look at the user's uploaded screenshot. Extract the exact colors, typography, aspect-ratios, and alignment. Match the design 1-to-1.\n2. SCOPED CSS: All custom CSS MUST be scoped to prevent leaking (e.g., use '#shopify-section-{{ section.id }} .your-class').\n3. MODERN IMAGES: Never use raw <img> tags for dynamic images. Use the OS 2.0 image tag filter to pass linting: '{{ block.settings.image | image_url: width: 800 | image_tag }}'.\n4. MASTER SCHEMA: Build a comprehensive {% schema %}. You MUST include 'header' types to group settings into 'Layout' (ranges for padding), 'Colors' (color and color_background), and 'Typography'.\n5. BLOCKS & PRESETS: Any repeating element (sliders, grids, galleries) MUST be built using 'blocks'. You MUST include a 'presets' array with default blocks, otherwise the section will not appear in the Theme Editor.\n6. UI/UX: Do not use native scrollbars for horizontal sliders. Use CSS scroll-snap. Ensure mobile-first responsiveness.\n7. Push the final code via the draftThemeArtifact tool.";
      }

      return {
        success: true,
        url,
        selector: cssSelector || "body",
        contentLength: markup.length,
        markup: markup.length > 0 ? markup : "Geen valide UI content om uit te parsen.",
      };
    } catch (error) {
      return {
        success: false,
        error: `Kon referentie UI niet inlezen of parsen: ${error.message}`,
      };
    }
  }
};
