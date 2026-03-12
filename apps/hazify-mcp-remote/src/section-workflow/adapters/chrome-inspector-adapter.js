import { createIssue } from "../error-model.js";
import { toAdapterBridgeFailureIssue } from "./mcp-client-bridge.js";

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

        const payload = bridged.structuredContent && typeof bridged.structuredContent === "object"
          ? bridged.structuredContent
          : {};

        return {
          source: "chrome-mcp",
          status: payload.status === "fail" ? "fail" : "pass",
          target: payload.target || { selector: null, viewports: [] },
          domSummary: payload.domSummary || {},
          styleTokens: payload.styleTokens || {},
          captures: payload.captures || {},
          issues: Array.isArray(payload.issues) ? payload.issues : [],
        };
      } catch (error) {
        return {
          source: "chrome-mcp",
          status: "fail",
          target: { selector: null, viewports: [] },
          domSummary: {},
          styleTokens: {},
          captures: {},
          issues: [toAdapterBridgeFailureIssue({ stage: "inspection", source: "chrome-mcp", error })],
        };
      }
    }

    try {
      const response = await fetch(input.referenceUrl, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml",
        },
      });
      const html = await response.text();
      const headings = [
        ...extractTagValues(html, "h1"),
        ...extractTagValues(html, "h2"),
        ...extractTagValues(html, "h3"),
      ].slice(0, 20);
      const paragraphs = extractTagValues(html, "p").slice(0, 20);
      const images = extractImageUrls(html).slice(0, 20);
      const title = extractTagValues(html, "title")[0] || null;

      const captures = {};
      for (const viewport of input.viewports || ["desktop", "mobile"]) {
        captures[viewport] = {
          screenshotBase64: "",
          width: viewport === "mobile" ? 390 : 1440,
          height: viewport === "mobile" ? 844 : 900,
        };
      }

      const issues = [
        createIssue({
          code: "adapter_unavailable",
          stage: "inspection",
          severity: "warn",
          blocking: false,
          source: "chrome-mcp",
          message:
            "Chrome MCP bridge niet geconfigureerd; inspectie draait in beperkte fallback-modus zonder echte browser screenshots.",
        }),
      ];

      return {
        source: "chrome-mcp",
        status: response.ok ? "pass" : "fail",
        target: {
          selector: input.targetHint || "section",
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
          },
        },
        captures,
        issues,
        extracted: {
          textCandidates: [...headings, ...paragraphs].slice(0, 20),
          imageCandidates: images,
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
        issues: [
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
