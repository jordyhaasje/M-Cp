#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SOURCE = "shopify-dev-mcp";
const DEFAULT_TIMEOUT_MS = Number(process.env.HAZIFY_SECTION_PROVIDER_TIMEOUT_MS || 45000);

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
        bridge: "shopify-dev-provider-bridge",
        upstream: "@shopify/dev-mcp",
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

const extractSchemaJsonFromLiquid = (liquidContent) => {
  const match = String(liquidContent || "").match(/\{\%\s*schema\s*\%\}([\s\S]*?)\{\%\s*endschema\s*\%\}/i);
  return match?.[1] ? String(match[1]).trim() : "";
};

const normalizeThemeFilePath = (filePath) => {
  const normalized = String(filePath || "").replace(/^[/\\]+/, "");
  const safePath = path.posix.normalize(normalized.replace(/\\/g, "/"));
  if (!safePath || safePath.startsWith("..") || safePath.includes("/../")) {
    throw new Error(`Ongeldig theme pad: ${filePath}`);
  }
  return safePath;
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

const upstreamConfig = {
  command: String(process.env.HAZIFY_SECTION_SHOPIFY_DEV_UPSTREAM_COMMAND || "npx").trim(),
  args: parseArgs(process.env.HAZIFY_SECTION_SHOPIFY_DEV_UPSTREAM_ARGS, ["-y", "@shopify/dev-mcp"]),
  cwd: String(process.env.HAZIFY_SECTION_SHOPIFY_DEV_UPSTREAM_CWD || "").trim() || process.cwd(),
  api: String(process.env.HAZIFY_SECTION_SHOPIFY_DEV_API || "liquid").trim() || "liquid",
};

const withShopifyClient = async (fn, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const client = new Client({ name: "hazify-shopify-dev-provider-bridge", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: upstreamConfig.command,
    args: upstreamConfig.args,
    cwd: upstreamConfig.cwd,
    env: process.env,
    stderr: "inherit",
  });

  await callWithTimeout(client.connect(transport), timeoutMs, "shopify-dev provider initialize");
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
};

const callTool = async (client, name, args, timeoutMs = DEFAULT_TIMEOUT_MS) =>
  callWithTimeout(client.callTool({ name, arguments: args || {} }), timeoutMs, `shopify-dev tool ${name}`);

const extractConversationId = (text) => {
  const match = String(text || "").match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  return match?.[0] || null;
};

const parseThemeValidationStatus = (text) => {
  const value = String(text || "");
  if (!value.trim()) {
    return { status: "warn", summary: "Geen validatietekst ontvangen van Shopify Dev MCP." };
  }

  if (/overall status:\s*❌|overall status:\s*.*invalid|\binvalid\b|\bfailed\b/i.test(value)) {
    return { status: "fail", summary: "Shopify Dev MCP markeerde de bundle als ongeldig." };
  }

  if (/warning|\bwarn\b|⚠/i.test(value)) {
    return { status: "warn", summary: "Shopify Dev MCP gaf waarschuwingen terug." };
  }

  return { status: "pass", summary: "Shopify Dev MCP validatie geslaagd." };
};

const findSectionFile = (bundle) =>
  (Array.isArray(bundle?.files) ? bundle.files : []).find(
    (entry) => String(entry?.path || "").startsWith("sections/") && String(entry?.path || "").endsWith(".liquid")
  );

const findSectionHandle = (bundle) => {
  const sectionFile = findSectionFile(bundle);
  const filePath = String(sectionFile?.path || "");
  const match = filePath.match(/^sections\/(.+)\.liquid$/i);
  return match?.[1] || "generated-section";
};

const writeThemeSkeleton = async (rootDir) => {
  await fs.mkdir(path.join(rootDir, "sections"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "templates"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "locales"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "config"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "locales", "en.default.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(rootDir, "config", "settings_schema.json"), "[]\n", "utf8");
  await fs.writeFile(path.join(rootDir, "config", "settings_data.json"), "{}\n", "utf8");
};

const writeBundleToThemeDir = async ({ bundle, rootDir, includeTemplate, templateKey }) => {
  const files = Array.isArray(bundle?.files) ? bundle.files : [];
  const filesCreatedOrUpdated = [];

  for (const entry of files) {
    const safePath = normalizeThemeFilePath(entry?.path || "");
    const absolutePath = path.join(rootDir, safePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, String(entry?.content || ""), "utf8");
    filesCreatedOrUpdated.push({ path: safePath });
  }

  if (includeTemplate) {
    const safeTemplatePath = normalizeThemeFilePath(templateKey || "templates/index.json");
    const handle = findSectionHandle(bundle);
    const templateJson = {
      sections: {
        main: {
          type: handle,
          settings: {},
        },
      },
      order: ["main"],
    };

    const templateAbsolutePath = path.join(rootDir, safeTemplatePath);
    await fs.mkdir(path.dirname(templateAbsolutePath), { recursive: true });
    await fs.writeFile(templateAbsolutePath, `${JSON.stringify(templateJson, null, 2)}\n`, "utf8");
    filesCreatedOrUpdated.push({ path: safeTemplatePath });
  }

  return filesCreatedOrUpdated;
};

const runShopifyThemeValidation = async ({ bundle, includeTemplate, templateKey, timeoutMs }) => {
  return withShopifyClient(async (client) => {
    const learnResult = await callTool(
      client,
      "learn_shopify_api",
      { api: upstreamConfig.api },
      timeoutMs
    );
    const conversationId = extractConversationId(extractTextFromContent(learnResult));
    if (!conversationId) {
      throw new Error("Shopify Dev MCP gaf geen bruikbare conversationId terug.");
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hazify-shopify-dev-"));
    try {
      await writeThemeSkeleton(tempRoot);
      const filesCreatedOrUpdated = await writeBundleToThemeDir({
        bundle,
        rootDir: tempRoot,
        includeTemplate,
        templateKey,
      });

      const validateResult = await callTool(
        client,
        "validate_theme",
        {
          conversationId,
          absoluteThemePath: tempRoot,
          filesCreatedOrUpdated,
        },
        timeoutMs
      );

      const validationText = extractTextFromContent(validateResult);
      return {
        status: parseThemeValidationStatus(validationText),
        validationText,
      };
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }, timeoutMs);
};

const pushIssue = (collection, payload) => {
  collection.push(issue(payload));
};

const handleValidateBundleSchema = async (args) => {
  const strict = Boolean(args?.strict ?? true);
  const bundle = args?.bundle || {};
  const themeContext = args?.themeContext || {};
  const templateKey = String(themeContext?.templateKey || bundle?.suggestedTemplateKey || "templates/index.json");
  const timeoutMs = Number(args?.timeoutMs) || DEFAULT_TIMEOUT_MS;

  const issues = [];
  const schemaIssues = [];
  const templateIssues = [];

  const sectionFile = findSectionFile(bundle);
  if (!sectionFile?.content) {
    const payload = {
      code: "schema_invalid",
      stage: "validation",
      message: "Bundle mist sections/*.liquid content.",
    };
    pushIssue(issues, payload);
    pushIssue(schemaIssues, payload);
  } else {
    const schemaRaw = extractSchemaJsonFromLiquid(sectionFile.content);
    if (!schemaRaw) {
      const payload = {
        code: "schema_invalid",
        stage: "validation",
        message: "Section liquid bevat geen {% schema %} blok.",
      };
      pushIssue(issues, payload);
      pushIssue(schemaIssues, payload);
    } else {
      const parsedSchema = safeJsonParse(schemaRaw);
      if (!parsedSchema || typeof parsedSchema !== "object") {
        const payload = {
          code: "schema_invalid",
          stage: "validation",
          message: "Section schema JSON is ongeldig en kon niet worden geparsed.",
        };
        pushIssue(issues, payload);
        pushIssue(schemaIssues, payload);
      } else {
        if (!String(parsedSchema.name || "").trim()) {
          const payload = {
            code: "schema_invalid",
            stage: "validation",
            message: "Section schema mist verplicht veld 'name'.",
          };
          pushIssue(issues, payload);
          pushIssue(schemaIssues, payload);
        }

        if (!Array.isArray(parsedSchema.presets) || parsedSchema.presets.length === 0) {
          const payload = {
            code: "schema_invalid",
            stage: "validation",
            message: "Section schema moet minimaal één preset bevatten.",
          };
          pushIssue(issues, payload);
          pushIssue(schemaIssues, payload);
        }
      }
    }
  }

  if (!templateKey.startsWith("templates/")) {
    const payload = {
      code: "template_insert_invalid",
      stage: "validation",
      severity: strict ? "error" : "warn",
      blocking: strict,
      message: `Template key '${templateKey}' moet onder templates/ staan.`,
    };
    pushIssue(issues, payload);
    pushIssue(templateIssues, payload);
  }

  if (!templateKey.endsWith(".json")) {
    const payload = {
      code: "template_insert_invalid",
      stage: "validation",
      severity: strict ? "error" : "warn",
      blocking: strict,
      message: `Template key '${templateKey}' moet op .json eindigen.`,
    };
    pushIssue(issues, payload);
    pushIssue(templateIssues, payload);
  }

  try {
    const providerValidation = await runShopifyThemeValidation({
      bundle,
      includeTemplate: false,
      templateKey,
      timeoutMs,
    });

    if (providerValidation.status.status === "fail") {
      const payload = {
        code: "schema_invalid",
        stage: "validation",
        message: providerValidation.status.summary,
        details: {
          validationText: providerValidation.validationText.slice(0, 16000),
        },
      };
      pushIssue(issues, payload);
      pushIssue(schemaIssues, payload);
    } else if (providerValidation.status.status === "warn") {
      const payload = {
        code: "schema_warning",
        stage: "validation",
        severity: "warn",
        blocking: false,
        message: providerValidation.status.summary,
        details: {
          validationText: providerValidation.validationText.slice(0, 16000),
        },
      };
      pushIssue(issues, payload);
    }
  } catch (error) {
    const payload = {
      code: String(error?.code || "adapter_unavailable"),
      stage: "validation",
      message: error instanceof Error ? error.message : String(error),
      details: {
        upstreamCommand: upstreamConfig.command,
        upstreamArgs: upstreamConfig.args,
      },
    };
    pushIssue(issues, payload);
    pushIssue(schemaIssues, payload);
  }

  const hasBlocking = issues.some((entry) => entry.blocking);
  const hasWarn = issues.some((entry) => entry.severity === "warn");

  return {
    source: SOURCE,
    status: hasBlocking ? "fail" : hasWarn ? "warn" : "pass",
    schema: {
      status: schemaIssues.some((entry) => entry.severity === "error")
        ? "fail"
        : schemaIssues.length
          ? "warn"
          : "pass",
      issues: schemaIssues,
    },
    template: {
      status: templateIssues.some((entry) => entry.severity === "error")
        ? "fail"
        : templateIssues.length
          ? "warn"
          : "pass",
      issues: templateIssues,
    },
    issues,
  };
};

const handleValidateTemplateInstallability = async (args) => {
  const strict = Boolean(args?.strict ?? true);
  const bundle = args?.bundle || {};
  const themeContext = args?.themeContext || {};
  const templateKey = String(themeContext?.templateKey || bundle?.suggestedTemplateKey || "templates/index.json");
  const timeoutMs = Number(args?.timeoutMs) || DEFAULT_TIMEOUT_MS;

  const issues = [];

  if (!templateKey.startsWith("templates/")) {
    pushIssue(issues, {
      code: "template_insert_invalid",
      stage: "validation",
      severity: strict ? "error" : "warn",
      blocking: strict,
      message: `Template key '${templateKey}' moet onder templates/ staan.`,
    });
  }

  if (!templateKey.endsWith(".json")) {
    pushIssue(issues, {
      code: "template_insert_invalid",
      stage: "validation",
      severity: strict ? "error" : "warn",
      blocking: strict,
      message: `Template key '${templateKey}' moet op .json eindigen.`,
    });
  }

  try {
    const providerValidation = await runShopifyThemeValidation({
      bundle,
      includeTemplate: true,
      templateKey,
      timeoutMs,
    });

    if (providerValidation.status.status === "fail") {
      pushIssue(issues, {
        code: "template_insert_invalid",
        stage: "validation",
        severity: "error",
        blocking: true,
        message: providerValidation.status.summary,
        details: {
          validationText: providerValidation.validationText.slice(0, 16000),
        },
      });
    } else if (providerValidation.status.status === "warn") {
      pushIssue(issues, {
        code: "template_insert_warning",
        stage: "validation",
        severity: "warn",
        blocking: false,
        message: providerValidation.status.summary,
        details: {
          validationText: providerValidation.validationText.slice(0, 16000),
        },
      });
    }
  } catch (error) {
    pushIssue(issues, {
      code: String(error?.code || "adapter_unavailable"),
      stage: "validation",
      severity: "error",
      blocking: true,
      message: error instanceof Error ? error.message : String(error),
      details: {
        upstreamCommand: upstreamConfig.command,
        upstreamArgs: upstreamConfig.args,
      },
    });
  }

  const hasBlocking = issues.some((entry) => entry.blocking);
  const hasWarn = issues.some((entry) => entry.severity === "warn");

  return {
    source: SOURCE,
    status: hasBlocking ? "fail" : hasWarn ? "warn" : "pass",
    template: {
      status: hasBlocking ? "fail" : hasWarn ? "warn" : "pass",
      issues,
    },
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
    case "validate-bundle-schema": {
      const structuredContent = await handleValidateBundleSchema(args);
      writeResult(structuredContent, { toolName });
      return;
    }
    case "validate-template-installability": {
      const structuredContent = await handleValidateTemplateInstallability(args);
      writeResult(structuredContent, { toolName });
      return;
    }
    default:
      writeBridgeError("invalid_input", `Onbekende bridge toolName '${toolName}' voor shopify-dev-provider-bridge.`);
  }
};

main().catch((error) => {
  writeBridgeError("runtime_error", error instanceof Error ? error.message : String(error));
});
