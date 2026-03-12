#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const SOURCE = "chrome-mcp";
const DEFAULT_TIMEOUT_MS = Number(process.env.HAZIFY_SECTION_PROVIDER_TIMEOUT_MS || 45000);

const VIEWPORT_CONFIG = {
  desktop: {
    width: 1440,
    height: 900,
    mcpViewport: "1440x900x1",
  },
  mobile: {
    width: 390,
    height: 844,
    mcpViewport: "390x844x2,mobile,touch",
  },
};

const safeJsonParse = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
};

const parseArgs = (value, fallback) => {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  const parsed = safeJsonParse(value.trim());
  if (Array.isArray(parsed)) {
    return parsed.map((entry) => String(entry));
  }
  return value
    .trim()
    .split(/\s+/g)
    .map((entry) => String(entry).trim())
    .filter(Boolean);
};

const issue = ({
  code,
  stage,
  severity = "error",
  blocking = true,
  message,
  details = null,
}) => ({
  code,
  stage,
  severity,
  blocking,
  source: SOURCE,
  message,
  details,
});

const readStdinPayload = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return null;
  }
  return safeJsonParse(raw);
};

const writeResult = (structuredContent, extra = {}) => {
  process.stdout.write(
    `${JSON.stringify({
      content: [],
      structuredContent,
      raw: {
        bridge: "chrome-provider-bridge",
        upstream: "chrome-devtools-mcp",
        ...extra,
      },
    })}\n`
  );
};

const writeBridgeError = (code, message, details = null) => {
  process.stdout.write(
    `${JSON.stringify({
      error: code,
      message,
      details,
    })}\n`
  );
};

const extractTextFromContent = (result) => {
  const chunks = Array.isArray(result?.content) ? result.content : [];
  return chunks
    .filter((entry) => entry && typeof entry === "object" && entry.type === "text" && entry.text)
    .map((entry) => String(entry.text))
    .join("\n");
};

const parseJsonFromMcpText = (textValue) => {
  const text = String(textValue || "").trim();
  if (!text) {
    return null;
  }

  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    const parsed = safeJsonParse(codeBlockMatch[1].trim());
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }

  const direct = safeJsonParse(text);
  if (direct && typeof direct === "object") {
    return direct;
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    const parsed = safeJsonParse(objectMatch[0]);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }

  return null;
};

const extractImageBase64 = (result) => {
  const chunks = Array.isArray(result?.content) ? result.content : [];
  for (const chunk of chunks) {
    if (chunk && typeof chunk === "object" && chunk.type === "image" && typeof chunk.data === "string") {
      return chunk.data;
    }
  }
  return null;
};

const extractFilePathFromScreenshotText = (textValue) => {
  const text = String(textValue || "");
  if (!text.trim()) {
    return null;
  }

  const patterns = [
    /(?:saved|written|path)\s*(?:to|:)\s*["']?([^"'\s]+?\.(?:png|jpg|jpeg|webp))/i,
    /(\/[^\s"']+?\.(?:png|jpg|jpeg|webp))/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return String(match[1]).trim();
    }
  }

  return null;
};

const extractInlineBase64FromText = (textValue) => {
  const text = String(textValue || "");
  if (!text.trim()) {
    return null;
  }

  const match = text.match(/data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)/i);
  return match?.[1] ? String(match[1]).trim() : null;
};

const readScreenshotFileAsBase64 = (filePath) => {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath || !fs.existsSync(normalizedPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(normalizedPath);
    return raw.length > 0 ? raw.toString("base64") : null;
  } catch (_error) {
    return null;
  } finally {
    try {
      fs.rmSync(normalizedPath, { force: true });
    } catch (_error) {
      // Best effort cleanup only.
    }
  }
};

const makeScreenshotFilePath = (viewportId) =>
  path.join(
    os.tmpdir(),
    `hazify-chrome-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}-${String(viewportId || "unknown")}.png`
  );

const captureScreenshotBase64 = async ({ client, timeoutMs, viewportId }) => {
  const screenshotFilePath = makeScreenshotFilePath(viewportId);
  let screenshot = null;
  let screenshotError = null;

  try {
    screenshot = await callTool(client, "take_screenshot", { filePath: screenshotFilePath }, timeoutMs);
  } catch (error) {
    screenshotError = error;
    screenshot = await callTool(client, "take_screenshot", {}, timeoutMs);
  }

  const textPayload = extractTextFromContent(screenshot);
  const contentBase64 = extractImageBase64(screenshot);
  const inlineBase64 = extractInlineBase64FromText(textPayload);
  const responsePathBase64 = readScreenshotFileAsBase64(extractFilePathFromScreenshotText(textPayload));
  const filePathBase64 = readScreenshotFileAsBase64(screenshotFilePath);

  return {
    screenshotBase64: contentBase64 || inlineBase64 || responsePathBase64 || filePathBase64 || "",
    screenshotError,
    attemptedFilePath: screenshotFilePath,
    usedFallbackToolArgs: Boolean(screenshotError),
  };
};

const sanitizeLiquidForPreview = (input) => {
  const withoutSchema = String(input || "").replace(
    /\{\%\s*schema\s*\%\}[\s\S]*?\{\%\s*endschema\s*\%\}/gi,
    ""
  );
  const withoutTags = withoutSchema
    .replace(/\{\%[\s\S]*?\%\}/g, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "")
    .trim();

  if (!withoutTags) {
    return "<section><p>Generated section preview (liquid stripped).</p></section>";
  }

  return withoutTags;
};

const getViewportConfig = (id) => VIEWPORT_CONFIG[id] || VIEWPORT_CONFIG.desktop;

const cropToSharedSize = (png, width, height) => {
  if (png.width === width && png.height === height) {
    return png;
  }
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, 0, 0, width, height, 0, 0);
  return out;
};

const normalizeBase64Png = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const encoded = raw.startsWith("data:") ? raw.split(",").slice(1).join(",") : raw;
  if (!encoded) {
    return null;
  }
  return encoded;
};

const compareBase64Png = (leftBase64, rightBase64) => {
  const left = normalizeBase64Png(leftBase64);
  const right = normalizeBase64Png(rightBase64);
  if (!left || !right) {
    return null;
  }

  const leftPng = PNG.sync.read(Buffer.from(left, "base64"));
  const rightPng = PNG.sync.read(Buffer.from(right, "base64"));
  const width = Math.min(leftPng.width, rightPng.width);
  const height = Math.min(leftPng.height, rightPng.height);

  if (!width || !height) {
    return null;
  }

  const leftPrepared = cropToSharedSize(leftPng, width, height);
  const rightPrepared = cropToSharedSize(rightPng, width, height);
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    leftPrepared.data,
    rightPrepared.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );

  return {
    mismatchRatio: mismatchedPixels / (width * height),
    width,
    height,
  };
};

const defaultUpstreamArgs = [
  "-y",
  "chrome-devtools-mcp",
  "--headless",
  "--isolated",
  "--no-usage-statistics",
  "--chromeArg=--no-sandbox",
  "--chromeArg=--disable-setuid-sandbox",
];

const baseUpstreamConfig = {
  command: String(process.env.HAZIFY_SECTION_CHROME_UPSTREAM_COMMAND || "npx").trim(),
  args: parseArgs(process.env.HAZIFY_SECTION_CHROME_UPSTREAM_ARGS, defaultUpstreamArgs),
  cwd: String(process.env.HAZIFY_SECTION_CHROME_UPSTREAM_CWD || "").trim() || process.cwd(),
};

let cachedPlaywrightExecutablePath;
let latestResolvedUpstreamConfig = null;

const hasExecutablePathArg = (args) =>
  Array.isArray(args) &&
  args.some((entry) => /^--executable(?:-path|Path)(=|$)/.test(String(entry || "").trim()));

const isChromeDevtoolsMcpArg = (arg) => /^chrome-devtools-mcp(?:@.+)?$/.test(String(arg || "").trim());

const shouldResolveChromeExecutableForUpstream = (args) =>
  Array.isArray(args) && args.some((entry) => isChromeDevtoolsMcpArg(entry));

const resolvePlaywrightChromiumExecutablePath = async () => {
  if (cachedPlaywrightExecutablePath !== undefined) {
    return cachedPlaywrightExecutablePath;
  }

  try {
    const { chromium } = await import("playwright");
    const executablePath = String(chromium.executablePath() || "").trim();
    cachedPlaywrightExecutablePath =
      executablePath && fs.existsSync(executablePath) ? executablePath : null;
  } catch (_error) {
    cachedPlaywrightExecutablePath = null;
  }

  return cachedPlaywrightExecutablePath;
};

const resolveChromeExecutablePath = async () => {
  const explicitPath = String(
    process.env.HAZIFY_SECTION_CHROME_EXECUTABLE_PATH ||
      process.env.HAZIFY_SECTION_CHROME_UPSTREAM_EXECUTABLE_PATH ||
      ""
  ).trim();

  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath;
  }

  return resolvePlaywrightChromiumExecutablePath();
};

const resolveUpstreamConfig = async () => {
  const args = Array.isArray(baseUpstreamConfig.args) ? [...baseUpstreamConfig.args] : [];

  if (!hasExecutablePathArg(args) && shouldResolveChromeExecutableForUpstream(args)) {
    const executablePath = await resolveChromeExecutablePath();
    if (executablePath) {
      args.push(`--executable-path=${executablePath}`);
    }
  }

  const resolved = {
    command: baseUpstreamConfig.command,
    args,
    cwd: baseUpstreamConfig.cwd,
  };
  latestResolvedUpstreamConfig = resolved;
  return resolved;
};

const callWithTimeout = async (promise, timeoutMs, label) => {
  const timeout = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label} timed out after ${timeout}ms`);
          error.code = "adapter_timeout";
          reject(error);
        }, timeout);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const withChromeClient = async (fn, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const upstreamConfig = await resolveUpstreamConfig();
  const client = new Client({ name: "hazify-chrome-provider-bridge", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: upstreamConfig.command,
    args: upstreamConfig.args,
    cwd: upstreamConfig.cwd,
    env: process.env,
    stderr: "inherit",
  });

  await callWithTimeout(client.connect(transport), timeoutMs, "chrome provider initialize");
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
};

const callTool = async (client, name, args, timeoutMs = DEFAULT_TIMEOUT_MS) =>
  callWithTimeout(client.callTool({ name, arguments: args || {} }), timeoutMs, `chrome tool ${name}`);

const toStringArray = (values) =>
  Array.isArray(values) ? values.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];

const uniqueValues = (values) => {
  const seen = new Set();
  const output = [];
  for (const value of toStringArray(values)) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
};

const tokenizeHints = (...values) => {
  const seen = new Set();
  for (const value of values) {
    const tokens = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 3);
    for (const token of tokens) {
      seen.add(token);
    }
  }
  return [...seen];
};

const prioritizeValues = (values, tokens, maxCount = 20) => {
  const entries = uniqueValues(values).map((value, index) => ({
    value,
    index,
    score: tokens.reduce((acc, token) => acc + (String(value).toLowerCase().includes(token) ? 1 : 0), 0),
  }));

  entries.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.index - right.index;
  });

  return entries.map((entry) => entry.value).slice(0, maxCount);
};

const handleInspectReference = async (args) => {
  const referenceUrl = String(args?.referenceUrl || "").trim();
  const targetHint = String(args?.targetHint || "").trim();
  const targetSelector = String(args?.targetSelector || "").trim();
  const visionHints = String(args?.visionHints || "").trim();
  const sharedImage = args?.sharedImage && typeof args.sharedImage === "object" ? args.sharedImage : null;
  const sharedImageUrl = String(sharedImage?.imageUrl || "").trim();
  const sharedImageBase64 = String(sharedImage?.imageBase64 || "").trim();
  const sharedImageProvided = Boolean(sharedImageUrl || sharedImageBase64);
  const sharedImageMalformed = Boolean(sharedImage && !sharedImageProvided);
  const semanticHintTokens = tokenizeHints(targetHint, visionHints, sharedImageUrl);
  const sharedImageUrlTokens = tokenizeHints(sharedImageUrl);
  const timeoutMs = Number(args?.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const viewportIds = Array.isArray(args?.viewports) && args.viewports.length
    ? [...new Set(args.viewports.map((entry) => String(entry).trim()).filter(Boolean))]
    : ["desktop", "mobile"];

  if (!referenceUrl) {
    return {
      source: SOURCE,
      status: "fail",
      target: { selector: null, viewports: [] },
      domSummary: {},
      styleTokens: {},
      captures: {},
      extracted: { textCandidates: [], imageCandidates: [] },
      issues: [issue({
        code: "invalid_input",
        stage: "inspection",
        message: "inspect-reference vereist een geldige referenceUrl.",
      })],
    };
  }

  try {
    return await withChromeClient(async (client) => {
      await callTool(client, "new_page", { url: referenceUrl }, timeoutMs);

      const evaluator = `() => {
        const explicitSelector = ${JSON.stringify(targetSelector)};
        const semanticHintTokens = ${JSON.stringify(semanticHintTokens)};
        const sharedImageUrlTokens = ${JSON.stringify(sharedImageUrlTokens)};
        const hasSharedImageBase64 = ${JSON.stringify(Boolean(sharedImageBase64))};
        const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const unique = (values) => Array.from(new Set(values.filter(Boolean)));
        const score = (value, tokens) => {
          const haystack = String(value || '').toLowerCase();
          if (!haystack) return 0;
          return tokens.reduce((acc, token) => acc + (haystack.includes(token) ? 1 : 0), 0);
        };
        const selectorForElement = (element) => {
          if (!element) return null;
          if (element.id) return '#' + element.id;
          const classes = element.classList ? Array.from(element.classList).slice(0, 2).join('.') : '';
          if (classes) return element.tagName.toLowerCase() + '.' + classes;
          return element.tagName.toLowerCase();
        };
        const collectText = (element) => unique(
          Array.from(element.querySelectorAll('h1, h2, h3, h4, p, li, a, span'))
            .map((el) => clean(el.innerText))
            .filter(Boolean)
        );
        const collectImages = (element) => unique(
          Array.from(element.querySelectorAll('img'))
            .map((el) => String(el.currentSrc || el.src || '').trim())
            .filter(Boolean)
        );
        const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map((el) => clean(el.innerText)).filter(Boolean).slice(0, 20);
        const paragraphs = Array.from(document.querySelectorAll('p')).map((el) => clean(el.innerText)).filter(Boolean).slice(0, 20);
        const images = Array.from(document.querySelectorAll('img')).map((el) => String(el.currentSrc || el.src || '').trim()).filter(Boolean).slice(0, 20);
        const candidates = unique(Array.from(document.querySelectorAll('main section, section, [data-section-id], [class*="section"], main > div, main article, article, [role="region"], main, body')));

        let explicitSelectorMatched = false;
        let targetElement = null;
        let targetReasoning = null;

        if (explicitSelector) {
          const matched = document.querySelector(explicitSelector);
          if (matched) {
            explicitSelectorMatched = true;
            targetElement = matched;
            targetReasoning = 'Target geselecteerd via expliciete targetSelector.';
          } else {
            targetReasoning = 'Expliciete targetSelector niet gevonden; semantische detectie toegepast.';
          }
        }

        if (!targetElement) {
          let best = null;
          for (const candidate of candidates) {
            const candidateText = collectText(candidate);
            const candidateImages = collectImages(candidate);
            const candidateSelector = selectorForElement(candidate);
            const candidateLabel = [
              candidate.id || '',
              candidate.className || '',
              candidate.getAttribute('aria-label') || '',
              candidate.getAttribute('data-section-id') || '',
            ].join(' ');
            const textScore = score(candidateText.join(' '), semanticHintTokens);
            const labelScore = score(candidateLabel, semanticHintTokens);
            const imageScore = score(candidateImages.join(' '), sharedImageUrlTokens);
            const imagePresenceBonus = hasSharedImageBase64 && candidateImages.length > 0 ? 1 : 0;
            const totalScore = textScore * 2 + labelScore * 2 + imageScore * 3 + imagePresenceBonus;

            if (!best || totalScore > best.totalScore) {
              best = {
                totalScore,
                element: candidate,
                selector: candidateSelector,
                text: candidateText,
                images: candidateImages,
              };
            }
          }

          if (best?.element) {
            targetElement = best.element;
            if (semanticHintTokens.length > 0 || sharedImageUrlTokens.length > 0 || hasSharedImageBase64) {
              targetReasoning = 'Target semantisch geselecteerd op basis van hints (score=' + best.totalScore + ').';
            } else {
              targetReasoning = 'Target geselecteerd op basis van standaard section-heuristiek.';
            }
          }
        }

        const targetTextCandidates = targetElement ? collectText(targetElement).slice(0, 20) : [];
        const targetImageCandidates = targetElement ? collectImages(targetElement).slice(0, 20) : [];
        const bodyStyle = getComputedStyle(document.body);
        return {
          title: document.title || null,
          headings,
          paragraphs,
          images,
          targetSelector: selectorForElement(targetElement),
          targetReasoning,
          targetTextCandidates,
          targetImageCandidates,
          hintUsage: {
            semanticHintTokensCount: semanticHintTokens.length,
            sharedImageUrlTokensCount: sharedImageUrlTokens.length,
            sharedImageMode: hasSharedImageBase64 ? 'base64' : (sharedImageUrlTokens.length > 0 ? 'url' : 'none'),
            explicitSelectorProvided: Boolean(explicitSelector),
            explicitSelectorMatched,
          },
          styleTokens: {
            body: {
              color: bodyStyle.color,
              backgroundColor: bodyStyle.backgroundColor,
              fontFamily: bodyStyle.fontFamily,
            },
          },
        };
      }`;

      const evaluation = await callTool(client, "evaluate_script", { function: evaluator }, timeoutMs);
      const evaluationPayload = parseJsonFromMcpText(extractTextFromContent(evaluation)) || {};
      const snapshot = await callTool(client, "take_snapshot", {}, timeoutMs);
      const snapshotText = extractTextFromContent(snapshot);

      const captures = {};
      const viewports = [];
      const captureDiagnostics = [];

      for (const viewportId of viewportIds) {
        const viewport = getViewportConfig(viewportId);
        await callTool(client, "emulate", { viewport: viewport.mcpViewport }, timeoutMs);
        const screenshotCapture = await captureScreenshotBase64({
          client,
          timeoutMs,
          viewportId,
        });
        const screenshotBase64 = screenshotCapture.screenshotBase64;

        captures[viewportId] = {
          screenshotBase64,
          width: viewport.width,
          height: viewport.height,
        };

        viewports.push({
          id: viewportId,
          clip: {
            x: 0,
            y: 0,
            width: viewport.width,
            height: viewport.height,
          },
        });

        if (!screenshotBase64) {
          captureDiagnostics.push({
            viewportId,
            attemptedFilePath: screenshotCapture.attemptedFilePath,
            usedFallbackToolArgs: screenshotCapture.usedFallbackToolArgs,
            error: screenshotCapture.screenshotError ? String(screenshotCapture.screenshotError.message || "") : null,
          });
        }
      }

      const textCandidates = prioritizeValues(
        [
          ...(Array.isArray(evaluationPayload.targetTextCandidates) ? evaluationPayload.targetTextCandidates : []),
          ...(Array.isArray(evaluationPayload.headings) ? evaluationPayload.headings : []),
          ...(Array.isArray(evaluationPayload.paragraphs) ? evaluationPayload.paragraphs : []),
        ],
        semanticHintTokens,
        20
      );

      const imageCandidates = prioritizeValues(
        [
          ...(Array.isArray(evaluationPayload.targetImageCandidates) ? evaluationPayload.targetImageCandidates : []),
          ...(Array.isArray(evaluationPayload.images) ? evaluationPayload.images : []),
        ],
        tokenizeHints(sharedImageUrl, targetHint, visionHints),
        20
      );

      const issues = [];
      if (sharedImageMalformed) {
        issues.push(
          issue({
            code: "shared_image_unreadable",
            stage: "inspection",
            severity: "warn",
            blocking: false,
            message: "sharedImage is aangeleverd zonder geldige imageUrl of imageBase64; inspectie gebruikte alleen URL/hints.",
          })
        );
      }
      if (sharedImageProvided && !sharedImageUrl && sharedImageBase64) {
        issues.push(
          issue({
            code: "shared_image_unreadable",
            stage: "inspection",
            severity: "warn",
            blocking: false,
            message:
              "sharedImage.imageBase64 is gebruikt als semantische beeldhint, maar zonder directe pixel-koppeling aan referentiebeelden.",
          })
        );
      }
      if (targetSelector && !evaluationPayload?.hintUsage?.explicitSelectorMatched) {
        issues.push(
          issue({
            code: "target_detection_failed",
            stage: "inspection",
            severity: "warn",
            blocking: false,
            message: "Expliciete targetSelector matchte niet; semantische target-detectie is gebruikt.",
          })
        );
      }
      if (captureDiagnostics.length > 0) {
        issues.push(
          issue({
            code: "inspection_visual_unavailable",
            stage: "inspection",
            severity: "warn",
            blocking: false,
            message:
              "Chrome provider leverde geen screenshot-binary voor een of meer viewports; inspectie gebruikt semantische extractie als fallback.",
            details: {
              captureDiagnostics,
            },
          })
        );
      }

      return {
        source: SOURCE,
        status: "pass",
        target: {
          selector: evaluationPayload.targetSelector || null,
          reasoning: evaluationPayload.targetReasoning || null,
          viewports,
        },
        domSummary: {
          title: evaluationPayload.title || null,
          headings: Array.isArray(evaluationPayload.headings) ? evaluationPayload.headings : [],
          paragraphs: Array.isArray(evaluationPayload.paragraphs) ? evaluationPayload.paragraphs : [],
          snapshot: snapshotText ? snapshotText.slice(0, 12000) : "",
        },
        styleTokens: evaluationPayload.styleTokens || {},
        extracted: {
          textCandidates,
          imageCandidates,
        },
        captures,
        issues,
      };
    }, timeoutMs);
  } catch (error) {
    const debugUpstream =
      latestResolvedUpstreamConfig ||
      {
        command: baseUpstreamConfig.command,
        args: baseUpstreamConfig.args,
      };
    return {
      source: SOURCE,
      status: "fail",
      target: { selector: null, viewports: [] },
      domSummary: {},
      styleTokens: {},
      captures: {},
      extracted: { textCandidates: [], imageCandidates: [] },
      issues: [
        issue({
          code: String(error?.code || "adapter_unavailable"),
          stage: "inspection",
          message: error instanceof Error ? error.message : String(error),
          details: {
            upstreamCommand: debugUpstream.command,
            upstreamArgs: debugUpstream.args,
          },
        }),
      ],
    };
  }
};

const handleRenderCandidate = async (args) => {
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const viewportIds = Array.isArray(args?.viewports) && args.viewports.length
    ? args.viewports.map((entry) => String(entry))
    : ["desktop", "mobile"];

  const sectionFile = (Array.isArray(args?.bundle?.files) ? args.bundle.files : []).find(
    (entry) => String(entry?.path || "").startsWith("sections/") && String(entry?.path || "").endsWith(".liquid")
  );

  const sectionMarkup = sanitizeLiquidForPreview(sectionFile?.content || "");
  const html = `<!doctype html><html><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><style>body{margin:0;padding:0;font-family:Arial,sans-serif}section{box-sizing:border-box}</style></head><body>${sectionMarkup}</body></html>`;
  const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  try {
    return await withChromeClient(async (client) => {
      await callTool(client, "new_page", { url: previewUrl }, timeoutMs);

      const captures = {};
      for (const viewportId of viewportIds) {
        const viewport = getViewportConfig(viewportId);
        await callTool(client, "emulate", { viewport: viewport.mcpViewport }, timeoutMs);
        const screenshot = await captureScreenshotBase64({
          client,
          timeoutMs,
          viewportId,
        });
        captures[viewportId] = {
          screenshotBase64: screenshot.screenshotBase64 || "",
          width: viewport.width,
          height: viewport.height,
        };
      }

      return {
        source: SOURCE,
        status: "pass",
        captures,
        issues: [],
      };
    }, timeoutMs);
  } catch (error) {
    return {
      source: SOURCE,
      status: "fail",
      captures: {},
      issues: [
        issue({
          code: String(error?.code || "adapter_unavailable"),
          stage: "validation",
          message: error instanceof Error ? error.message : String(error),
        }),
      ],
    };
  }
};

const handleCompareVisual = async (args) => {
  const inspectionCaptures = args?.inspection?.captures || {};
  const candidateCaptures = args?.candidate?.captures || {};
  const thresholds = {
    desktop: Number(args?.thresholds?.desktopMismatch ?? 0.12),
    mobile: Number(args?.thresholds?.mobileMismatch ?? 0.15),
  };

  const viewportIds = ["desktop", "mobile"];
  const perViewport = [];
  const issues = [];

  for (const viewportId of viewportIds) {
    const threshold = viewportId === "mobile" ? thresholds.mobile : thresholds.desktop;
    const inspectionBase64 = inspectionCaptures?.[viewportId]?.screenshotBase64 || "";
    const candidateBase64 = candidateCaptures?.[viewportId]?.screenshotBase64 || "";
    const compared = compareBase64Png(inspectionBase64, candidateBase64);

    if (!compared) {
      perViewport.push({
        id: viewportId,
        mismatchRatio: 0,
        threshold,
        pass: true,
      });
      issues.push(
        issue({
          code: "visual_compare_data_missing",
          stage: "validation",
          severity: "warn",
          blocking: false,
          message: `Visual compare voor viewport '${viewportId}' gebruikt fallback omdat screenshot-data ontbreekt.`,
        })
      );
      continue;
    }

    const pass = compared.mismatchRatio <= threshold;
    perViewport.push({
      id: viewportId,
      mismatchRatio: Number(compared.mismatchRatio.toFixed(6)),
      threshold,
      pass,
    });

    if (!pass) {
      issues.push(
        issue({
          code: "visual_gate_fail",
          stage: "validation",
          severity: "error",
          blocking: true,
          message: `Mismatch ratio ${compared.mismatchRatio.toFixed(4)} overschrijdt threshold ${threshold.toFixed(4)} voor ${viewportId}.`,
          details: {
            mismatchRatio: compared.mismatchRatio,
            threshold,
            width: compared.width,
            height: compared.height,
          },
        })
      );
    }
  }

  const hasBlocking = issues.some((entry) => entry.blocking);
  return {
    source: SOURCE,
    status: hasBlocking ? "fail" : "pass",
    perViewport,
    issues,
  };
};

const main = async () => {
  const request = await readStdinPayload();
  if (!request || typeof request !== "object") {
    writeBridgeError("invalid_input", "Bridge request ontbreekt of is geen geldig JSON object.");
    return;
  }

  const toolName = String(request.toolName || "").trim();
  const args = request.args && typeof request.args === "object" ? request.args : {};

  if (!toolName) {
    writeBridgeError("invalid_input", "Bridge request mist verplicht veld 'toolName'.");
    return;
  }

  switch (toolName) {
    case "inspect-reference": {
      const structuredContent = await handleInspectReference(args);
      writeResult(structuredContent, { toolName });
      return;
    }
    case "render-candidate": {
      const structuredContent = await handleRenderCandidate(args);
      writeResult(structuredContent, { toolName });
      return;
    }
    case "compare-visual": {
      const structuredContent = await handleCompareVisual(args);
      writeResult(structuredContent, { toolName });
      return;
    }
    default:
      writeBridgeError("invalid_input", `Onbekende bridge toolName '${toolName}' voor chrome-provider-bridge.`);
  }
};

main().catch((error) => {
  writeBridgeError("runtime_error", error instanceof Error ? error.message : String(error));
});
