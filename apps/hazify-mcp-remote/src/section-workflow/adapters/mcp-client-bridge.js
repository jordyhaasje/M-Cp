import { spawn } from "node:child_process";
import { normalizeUnknownError } from "../error-model.js";

const defaultTimeoutMs = 15000;

const parseJsonSafe = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
};

export class McpClientBridge {
  constructor({ providers = {} } = {}) {
    this.providers = providers;
  }

  getProvider(providerName) {
    return this.providers?.[providerName] || null;
  }

  async callTool({ provider, toolName, args, timeoutMs = defaultTimeoutMs }) {
    const providerConfig = this.getProvider(provider);
    if (!providerConfig) {
      throw new Error(`MCP provider '${provider}' is niet geconfigureerd.`);
    }

    if (typeof providerConfig.callTool === "function") {
      return providerConfig.callTool({ toolName, args, timeoutMs });
    }

    if (providerConfig.transport === "http") {
      const error = new Error(
        `MCP provider '${provider}' gebruikt HTTP bridge transport, maar dat is in v1 uitgeschakeld. Gebruik stdio subprocess transport.`
      );
      error.code = "bridge_transport_disabled";
      throw error;
    }

    if (providerConfig.transport !== "stdio" || !providerConfig.command) {
      throw new Error(`MCP provider '${provider}' heeft geen ondersteunde bridge transportconfig.`);
    }

    return this.callStdioProvider({ providerConfig, toolName, args, timeoutMs });
  }

  async callStdioProvider({ providerConfig, toolName, args, timeoutMs = defaultTimeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(timeoutMs) || defaultTimeoutMs);
    const mergedEnv = {
      ...process.env,
      ...(providerConfig.env && typeof providerConfig.env === "object" ? providerConfig.env : {}),
    };

    try {
      const requestPayload = JSON.stringify({ toolName, args });
      const subprocessOutput = await new Promise((resolve, reject) => {
        const child = spawn(providerConfig.command, Array.isArray(providerConfig.args) ? providerConfig.args : [], {
          cwd: providerConfig.cwd || process.cwd(),
          env: mergedEnv,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const settle = (fn, value) => {
          if (settled) {
            return;
          }
          settled = true;
          fn(value);
        };

        controller.signal.addEventListener(
          "abort",
          () => {
            const killSignal = providerConfig.killSignal || "SIGKILL";
            child.kill(killSignal);
            const timeoutError = new Error("MCP bridge stdio call timed out");
            timeoutError.name = "AbortError";
            settle(reject, timeoutError);
          },
          { once: true }
        );

        child.on("error", (error) => {
          settle(reject, error);
        });

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        child.on("close", (code) => {
          if (code !== 0) {
            const error = new Error(
              `MCP bridge stdio process exited with code ${code}: ${stderr.trim() || "unknown error"}`
            );
            error.code = "bridge_process_failed";
            settle(reject, error);
            return;
          }
          settle(resolve, { stdout, stderr });
        });

        child.stdin.write(requestPayload);
        child.stdin.end();
      });

      const parsed = parseJsonSafe(subprocessOutput.stdout) || {};
      if (parsed?.error) {
        const error = new Error(parsed?.message || "MCP bridge subprocess returned error");
        error.code = parsed.error;
        throw error;
      }

      return {
        content: parsed.content || [],
        structuredContent: parsed.structuredContent || parsed.result || null,
        raw: parsed,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const buildBridgeProviderConfigFromEnv = (env = process.env) => {
  const providers = {};

  const chromeCommand = String(env.HAZIFY_SECTION_CHROME_MCP_STDIO_COMMAND || "").trim();
  if (chromeCommand) {
    providers["chrome-mcp"] = {
      transport: "stdio",
      command: chromeCommand,
      args: parseStdioArgs(env.HAZIFY_SECTION_CHROME_MCP_STDIO_ARGS),
      cwd: String(env.HAZIFY_SECTION_CHROME_MCP_STDIO_CWD || "").trim() || undefined,
    };
  }

  const shopifyDevCommand = String(env.HAZIFY_SECTION_SHOPIFY_DEV_MCP_STDIO_COMMAND || "").trim();
  if (shopifyDevCommand) {
    providers["shopify-dev-mcp"] = {
      transport: "stdio",
      command: shopifyDevCommand,
      args: parseStdioArgs(env.HAZIFY_SECTION_SHOPIFY_DEV_MCP_STDIO_ARGS),
      cwd: String(env.HAZIFY_SECTION_SHOPIFY_DEV_MCP_STDIO_CWD || "").trim() || undefined,
    };
  }

  // Future-compatible placeholder: preserve HTTP env parsing, but runtime rejects it in v1.
  const chromeBaseUrl = String(env.HAZIFY_SECTION_CHROME_MCP_BASE_URL || "").trim();
  if (chromeBaseUrl && !providers["chrome-mcp"]) {
    providers["chrome-mcp"] = {
      transport: "http",
      baseUrl: chromeBaseUrl,
      apiKey: String(env.HAZIFY_SECTION_CHROME_MCP_API_KEY || "").trim() || null,
    };
  }

  const shopifyDevBaseUrl = String(env.HAZIFY_SECTION_SHOPIFY_DEV_MCP_BASE_URL || "").trim();
  if (shopifyDevBaseUrl && !providers["shopify-dev-mcp"]) {
    providers["shopify-dev-mcp"] = {
      transport: "http",
      baseUrl: shopifyDevBaseUrl,
      apiKey: String(env.HAZIFY_SECTION_SHOPIFY_DEV_MCP_API_KEY || "").trim() || null,
    };
  }

  return providers;
};

const parseStdioArgs = (rawValue) => {
  if (!rawValue || typeof rawValue !== "string") {
    return [];
  }
  const value = rawValue.trim();
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry));
    }
  } catch (_error) {
    // Fallback: split on whitespace.
  }
  return value.split(/\s+/g).filter(Boolean);
};

export const toAdapterBridgeFailureIssue = ({ stage, source, error }) =>
  normalizeUnknownError({
    stage,
    source,
    error,
    code: String(error?.name || "").toLowerCase().includes("abort") ? "adapter_timeout" : "adapter_unavailable",
  });
