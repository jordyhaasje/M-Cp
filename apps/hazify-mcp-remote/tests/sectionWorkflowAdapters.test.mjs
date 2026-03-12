import assert from "assert";
import {
  McpClientBridge,
  buildBridgeProviderConfigFromEnv,
  toAdapterBridgeFailureIssue,
} from "../src/section-workflow/adapters/mcp-client-bridge.js";
import { ChromeInspectorAdapter } from "../src/section-workflow/adapters/chrome-inspector-adapter.js";
import { ShopifyDevValidatorAdapter } from "../src/section-workflow/adapters/shopify-dev-validator-adapter.js";

const providerBridge = new McpClientBridge({
  providers: {
    "chrome-mcp": {
      callTool: async ({ toolName, args }) => ({
        content: [],
        structuredContent: {
          status: "pass",
          toolName,
          args,
        },
        raw: {},
      }),
    },
  },
});

const bridgeResponse = await providerBridge.callTool({
  provider: "chrome-mcp",
  toolName: "inspect-reference",
  args: { hello: "world" },
});
assert.equal(bridgeResponse.structuredContent.toolName, "inspect-reference");

const envProviders = buildBridgeProviderConfigFromEnv({
  HAZIFY_SECTION_CHROME_MCP_STDIO_COMMAND: "node",
  HAZIFY_SECTION_CHROME_MCP_STDIO_ARGS:
    "[\"apps/hazify-mcp-remote/scripts/section-providers/chrome-provider-bridge.mjs\"]",
  HAZIFY_SECTION_SHOPIFY_DEV_MCP_STDIO_COMMAND: "node",
  HAZIFY_SECTION_SHOPIFY_DEV_MCP_STDIO_ARGS:
    "[\"apps/hazify-mcp-remote/scripts/section-providers/shopify-dev-provider-bridge.mjs\"]",
});
assert.equal(envProviders["chrome-mcp"].transport, "stdio");
assert.deepEqual(envProviders["chrome-mcp"].args, [
  "apps/hazify-mcp-remote/scripts/section-providers/chrome-provider-bridge.mjs",
]);
assert.equal(envProviders["shopify-dev-mcp"].transport, "stdio");
assert.deepEqual(envProviders["shopify-dev-mcp"].args, [
  "apps/hazify-mcp-remote/scripts/section-providers/shopify-dev-provider-bridge.mjs",
]);

const httpBridge = new McpClientBridge({
  providers: {
    "chrome-mcp": {
      transport: "http",
      baseUrl: "https://chrome.example",
      apiKey: "abc",
    },
  },
});
await assert.rejects(
  () =>
    httpBridge.callTool({
      provider: "chrome-mcp",
      toolName: "inspect-reference",
      args: {},
    }),
  /v1 uitgeschakeld/i
);

const timeoutIssue = toAdapterBridgeFailureIssue({
  stage: "validation",
  source: "chrome-mcp",
  error: { name: "AbortError", message: "timed out" },
});
assert.equal(timeoutIssue.code, "adapter_timeout");

const originalFetch = global.fetch;
global.fetch = async () =>
  new Response(
    `
    <html>
      <head><title>Demo page</title></head>
      <body>
        <h1>Hero Heading</h1>
        <p>Hero body text</p>
        <img src="https://cdn.example.com/a.jpg" />
      </body>
    </html>
  `,
    { status: 200, headers: { "content-type": "text/html" } }
  );

try {
  const chromeFallback = new ChromeInspectorAdapter({ bridge: null });
  const inspect = await chromeFallback.inspectReference({
    referenceUrl: "https://example.com",
    targetHint: "hero top banner",
    viewports: ["desktop", "mobile"],
    timeoutMs: 30000,
  });
  assert.equal(inspect.status, "pass");
  assert.ok(inspect.domSummary.title);
  assert.ok(Array.isArray(inspect.extracted.textCandidates));
  assert.notEqual(inspect.target.selector, "hero top banner");
  assert.match(String(inspect.target.reasoning || ""), /semantische detectie/i);
  assert.ok(inspect.issues.some((issue) => issue.code === "adapter_unavailable"));

  const proxyFailBridge = new ChromeInspectorAdapter({
    bridge: {
      async callTool() {
        const error = new Error("ValueError: File arg rewrite paths are required when proxied mounts are present.");
        error.code = "bridge_process_failed";
        throw error;
      },
    },
  });

  const inspectFromProxyFailure = await proxyFailBridge.inspectReference({
    referenceUrl: "https://example.com",
    targetHint: "headline section",
    visionHints: "blue background with centered title",
    sharedImage: {
      imageBase64: "ZmFrZQ==",
      mimeType: "image/png",
    },
    viewports: ["desktop", "mobile"],
    timeoutMs: 30000,
  });
  assert.equal(inspectFromProxyFailure.status, "pass");
  assert.ok(
    inspectFromProxyFailure.issues.some((entry) => entry.code === "shared_image_unreadable"),
    "sharedImage proxy failure should be surfaced with shared_image_unreadable"
  );
  assert.ok(
    inspectFromProxyFailure.issues.some((entry) => entry.code === "adapter_unavailable"),
    "bridge fallback should still include adapter_unavailable issue"
  );

  const compare = await chromeFallback.compareVisual({
    inspection: {},
    candidate: {},
    thresholds: { desktopMismatch: 0.12, mobileMismatch: 0.15 },
  });
  assert.equal(compare.status, "pass");
  assert.equal(compare.perViewport.length, 2);

  const validator = new ShopifyDevValidatorAdapter({ bridge: null });
  const bundle = {
    files: [
      {
        path: "sections/demo-section.liquid",
        content: `
<section></section>
{% schema %}
{
  "name": "Demo Section",
  "settings": [],
  "presets": [{ "name": "Demo" }]
}
{% endschema %}
`,
      },
    ],
    suggestedTemplateKey: "templates/index.json",
  };

  const schemaResult = await validator.validateBundleSchema({ bundle, strict: true });
  assert.equal(schemaResult.status, "pass");
  assert.equal(schemaResult.schema.status, "pass");
  assert.ok(schemaResult.issues.some((issue) => issue.code === "adapter_unavailable"));

  const templateResult = await validator.validateTemplateInstallability({
    bundle,
    strict: true,
    themeContext: { templateKey: "templates/index.json" },
  });
  assert.equal(templateResult.status, "pass");
} finally {
  global.fetch = originalFetch;
}

console.log("sectionWorkflowAdapters.test.mjs passed");
