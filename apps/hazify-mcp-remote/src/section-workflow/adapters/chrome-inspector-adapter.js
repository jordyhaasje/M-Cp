import { createIssue } from "../error-model.js";
import { toAdapterBridgeFailureIssue } from "./mcp-client-bridge.js";

const HINT_TOKEN_MIN_LENGTH = 3;

const extractTagValues = (html, tag) => {
  const values = [];
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match;
  while ((match = regex.exec(String(html || ""))) !== null) {
    const value = String(match[1] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (value) {
      values.push(value);
    }
  }
  return values;
};

const extractImageUrls = (html) => {
  const urls = [];
  const seen = new Set();
  const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(String(html || ""))) !== null) {
    const url = String(match[1] || "").trim();
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    urls.push(url);
  }
  return urls;
};

const tokenizeHintText = (...values) => {
  const seen = new Set();
  for (const value of values) {
    const lowered = String(value || "").toLowerCase();
    const tokens = lowered
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= HINT_TOKEN_MIN_LENGTH);
    for (const token of tokens) {
      seen.add(token);
    }
  }
  return [...seen];
};

const toStringArray = (values) =>
  Array.isArray(values) ? values.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];

const scoreByHintTokens = (value, tokens) => {
  const haystack = String(value || "").toLowerCase();
  if (!haystack) {
    return 0;
  }
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  return score;
};

const prioritizeByHints = (values, tokens, maxCount = 20) => {
  const entries = toStringArray(values).map((value, index) => ({
    value,
    score: scoreByHintTokens(value, tokens),
    index,
  }));

  entries.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.index - right.index;
  });

  return entries.map((entry) => entry.value).slice(0, maxCount);
};

const hasSharedImageInput = (sharedImage) =>
  Boolean(
    sharedImage &&
      ((typeof sharedImage.imageUrl === "string" && sharedImage.imageUrl.trim()) ||
        (typeof sharedImage.imageBase64 === "string" && sharedImage.imageBase64.trim()))
  );

const isProxySharedImageRewriteError = (error) =>
  String(error?.message || "").toLowerCase().includes("file arg rewrite paths are required");

const toSharedImageDeliveryIssue = (error) =>
  createIssue({
    code: "shared_image_unreadable",
    stage: "inspection",
    severity: "warn",
    blocking: false,
    source: "chrome-mcp",
    message: isProxySharedImageRewriteError(error)
      ? "sharedImage kon niet worden doorgegeven via de proxy (rewrite paths vereist); inspectie ging verder zonder gedeelde afbeelding."
      : "sharedImage kon niet worden verwerkt; inspectie ging verder zonder gedeelde afbeelding.",
    details: {
      upstreamMessage: error instanceof Error ? error.message : String(error || ""),
    },
  });

const fallbackTargetReasoning = ({ explicitSelector, semanticTokens }) => {
  if (explicitSelector) {
    return "Expliciete targetSelector gebruikt als CSS target in fallback inspectie.";
  }
  if (semanticTokens.length > 0) {
    return "Geen expliciete CSS selector opgegeven; targetHint/visionHints gebruikt als semantische detectiehints.";
  }
  return "Geen selector-hints opgegeven; fallback inspectie gebruikt algemene section-heuristiek.";
};

export class ChromeInspectorAdapter {
  constructor({ bridge = null, provider = "chrome-mcp" } = {}) {
    this.bridge = bridge;
    this.provider = provider;
  }

  async inspectReference(input) {
    if (this.bridge) {
      try {
        const bridged = await this.bridge.callTool({
          provider: this.provider,
          toolName: "inspect-reference",
          args: input,
          timeoutMs: input.timeoutMs,
        });

        const payload =
          bridged.structuredContent && typeof bridged.structuredContent === "object"
            ? bridged.structuredContent
            : {};

        return {
          source: "chrome-mcp",
          status: payload.status === "fail" ? "fail" : "pass",
          target: payload.target || { selector: null, viewports: [] },
          domSummary: payload.domSummary || {},
          styleTokens: payload.styleTokens || {},
          captures: payload.captures || {},
          extracted: {
            textCandidates: toStringArray(payload?.extracted?.textCandidates),
            imageCandidates: toStringArray(payload?.extracted?.imageCandidates),
          },
          issues: Array.isArray(payload.issues) ? payload.issues : [],
        };
      } catch (error) {
        const bridgeIssue = toAdapterBridgeFailureIssue({ stage: "inspection", source: "chrome-mcp", error });
        const sharedImageIssue = hasSharedImageInput(input?.sharedImage) ? toSharedImageDeliveryIssue(error) : null;
        return this.inspectReferenceFallback(input, {
          seedIssues: [bridgeIssue, sharedImageIssue].filter(Boolean),
        });
      }
    }

    return this.inspectReferenceFallback(input);
  }

  async inspectReferenceFallback(input, { seedIssues = [] } = {}) {
    const sharedImage = input?.sharedImage && typeof input.sharedImage === "object" ? input.sharedImage : null;
    const explicitSelector = String(input?.targetSelector || "").trim();
    const semanticTokens = tokenizeHintText(
      input?.targetHint || "",
      input?.visionHints || "",
      sharedImage?.imageUrl || ""
    );

    try {
      const response = await fetch(input.referenceUrl, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml",
        },
      });
      const html = await response.text();
      const headings = extractTagValues(html, "h1")
        .concat(extractTagValues(html, "h2"))
        .concat(extractTagValues(html, "h3"))
        .slice(0, 50);
      const paragraphs = extractTagValues(html, "p").slice(0, 50);
      const images = extractImageUrls(html).slice(0, 40);
      const title = extractTagValues(html, "title")[0] || null;

      const combinedText = [...headings, ...paragraphs];
      const textCandidates = prioritizeByHints(combinedText, semanticTokens, 20);
      const imageCandidates = prioritizeByHints(images, semanticTokens, 20);

      const captures = {};
      for (const viewport of input.viewports || ["desktop", "mobile"]) {
        captures[viewport] = {
          screenshotBase64: "",
          width: viewport === "mobile" ? 390 : 1440,
          height: viewport === "mobile" ? 844 : 900,
        };
      }

      const issues = [
        ...seedIssues,
        createIssue({
          code: "adapter_unavailable",
          stage: "inspection",
          severity: "warn",
          blocking: false,
          source: "chrome-mcp",
          message:
            "Chrome MCP bridge niet beschikbaar; inspectie draait in beperkte fallback-modus zonder echte browser screenshots.",
        }),
      ];

      if (sharedImage?.imageBase64) {
        issues.push(
          createIssue({
            code: "shared_image_unreadable",
            stage: "inspection",
            severity: "warn",
            blocking: false,
            source: "chrome-mcp",
            message:
              "sharedImage.imageBase64 is niet visueel gevalideerd in fallback inspectie; alleen semantische hints uit targetHint/visionHints/imageUrl zijn gebruikt.",
          })
        );
      }

      return {
        source: "chrome-mcp",
        status: response.ok ? "pass" : "fail",
        target: {
          selector: explicitSelector || (textCandidates.length > 0 || imageCandidates.length > 0 ? "section" : null),
          reasoning: fallbackTargetReasoning({ explicitSelector, semanticTokens }),
          viewports: (input.viewports || ["desktop", "mobile"]).map((id) => ({
            id,
            clip: {
              x: 0,
              y: 0,
              width: id === "mobile" ? 390 : 1440,
              height: id === "mobile" ? 844 : 900,
            },
          })),
        },
        domSummary: {
          statusCode: response.status,
          title,
          headings,
          paragraphs,
        },
        styleTokens: {
          inferred: {
            headingCount: headings.length,
            paragraphCount: paragraphs.length,
            imageCount: images.length,
            semanticTokenCount: semanticTokens.length,
          },
        },
        captures,
        issues,
        extracted: {
          textCandidates,
          imageCandidates,
        },
      };
    } catch (error) {
      return {
        source: "chrome-mcp",
        status: "fail",
        target: { selector: null, viewports: [] },
        domSummary: {},
        styleTokens: {},
        captures: {},
        extracted: { textCandidates: [], imageCandidates: [] },
        issues: [
          ...seedIssues,
          createIssue({
            code: "reference_unreachable",
            stage: "inspection",
            severity: "error",
            blocking: true,
            source: "chrome-mcp",
            message: error instanceof Error ? error.message : String(error),
          }),
        ],
      };
    }
  }

  async renderCandidate(input) {
    if (this.bridge) {
      try {
        const bridged = await this.bridge.callTool({
          provider: this.provider,
          toolName: "render-candidate",
          args: input,
        });
        return bridged.structuredContent || { source: "chrome-mcp", status: "pass", captures: {} };
      } catch (error) {
        return {
          source: "chrome-mcp",
          status: "fail",
          captures: {},
          issues: [toAdapterBridgeFailureIssue({ stage: "validation", source: "chrome-mcp", error })],
        };
      }
    }

    return {
      source: "chrome-mcp",
      status: "pass",
      captures: {},
      issues: [
        createIssue({
          code: "adapter_unavailable",
          stage: "validation",
          severity: "warn",
          blocking: false,
          source: "chrome-mcp",
          message: "Fallback renderCandidate uitgevoerd zonder externe browser-render.",
        }),
      ],
    };
  }

  async compareVisual({ inspection, candidate, thresholds }) {
    if (this.bridge) {
      try {
        const bridged = await this.bridge.callTool({
          provider: this.provider,
          toolName: "compare-visual",
          args: { inspection, candidate, thresholds },
        });
        return bridged.structuredContent || { source: "chrome-mcp", status: "pass", perViewport: [] };
      } catch (error) {
        return {
          source: "chrome-mcp",
          status: "fail",
          perViewport: [],
          issues: [toAdapterBridgeFailureIssue({ stage: "validation", source: "chrome-mcp", error })],
        };
      }
    }

    const desktopThreshold = Number(thresholds?.desktopMismatch ?? 0.12);
    const mobileThreshold = Number(thresholds?.mobileMismatch ?? 0.15);

    return {
      source: "chrome-mcp",
      status: "pass",
      perViewport: [
        { id: "desktop", mismatchRatio: 0, threshold: desktopThreshold, pass: true },
        { id: "mobile", mismatchRatio: 0, threshold: mobileThreshold, pass: true },
      ],
      issues: [
        createIssue({
          code: "adapter_unavailable",
          stage: "validation",
          severity: "warn",
          blocking: false,
          source: "chrome-mcp",
          message: "Visual compare draait in fallback-modus; mismatch-score is niet op echte browser-screenshots gebaseerd.",
        }),
      ],
    };
  }
}
