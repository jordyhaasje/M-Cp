import assert from "assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");

const chromeBridgeScript = path.resolve(
  testDir,
  "../scripts/section-providers/chrome-provider-bridge.mjs"
);
const shopifyBridgeScript = path.resolve(
  testDir,
  "../scripts/section-providers/shopify-dev-provider-bridge.mjs"
);

const fakeChromeProvider = path.resolve(
  testDir,
  "fixtures/section-providers/fake-chrome-provider.mjs"
);
const fakeShopifyProvider = path.resolve(
  testDir,
  "fixtures/section-providers/fake-shopify-dev-provider.mjs"
);

const runBridge = async ({ scriptPath, requestPayload, env = {}, timeoutMs = 20000 }) => {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;

    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      fn(value);
    };

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(reject, new Error(`Bridge process timed out after ${timeoutMs}ms for ${scriptPath}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      settle(reject, error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        settle(
          reject,
          new Error(
            `Bridge process failed with code ${code}. stdout=${stdout || "<empty>"} stderr=${stderr || "<empty>"}`
          )
        );
        return;
      }

      const parsed = (() => {
        try {
          return JSON.parse(stdout.trim());
        } catch (_error) {
          return null;
        }
      })();

      if (!parsed) {
        settle(
          reject,
          new Error(`Bridge returned non-JSON output. stdout=${stdout || "<empty>"} stderr=${stderr || "<empty>"}`)
        );
        return;
      }

      settle(resolve, parsed);
    });

    child.stdin.write(JSON.stringify(requestPayload));
    child.stdin.end();
  });
};

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hazify-bridge-tests-"));
const chromeLogPath = path.join(tempDir, "fake-chrome-provider.log");
const shopifyLogPath = path.join(tempDir, "fake-shopify-provider.log");

await fs.writeFile(chromeLogPath, "", "utf8");
await fs.writeFile(shopifyLogPath, "", "utf8");

const chromeEnv = {
  HAZIFY_SECTION_CHROME_UPSTREAM_COMMAND: process.execPath,
  HAZIFY_SECTION_CHROME_UPSTREAM_ARGS: JSON.stringify([fakeChromeProvider]),
  HAZIFY_SECTION_CHROME_UPSTREAM_CWD: repoRoot,
  FAKE_PROVIDER_LOG_FILE: chromeLogPath,
};

const inspectResponse = await runBridge({
  scriptPath: chromeBridgeScript,
  env: chromeEnv,
  requestPayload: {
    toolName: "inspect-reference",
    args: {
      referenceUrl: "https://example.com",
      targetHint: "section.hero",
      viewports: ["desktop", "mobile"],
      timeoutMs: 10000,
    },
  },
});

assert.equal(inspectResponse.structuredContent?.status, "pass");
assert.equal(inspectResponse.structuredContent?.source, "chrome-mcp");
assert.ok(inspectResponse.structuredContent?.captures?.desktop?.screenshotBase64);
assert.ok(inspectResponse.structuredContent?.captures?.mobile?.screenshotBase64);

const chromeLogAfterInspect = await fs.readFile(chromeLogPath, "utf8");
assert.ok(chromeLogAfterInspect.includes("new_page"));
assert.ok(chromeLogAfterInspect.includes("evaluate_script"));
assert.ok(chromeLogAfterInspect.includes("take_snapshot"));
assert.ok(chromeLogAfterInspect.includes("take_screenshot"));

const renderResponse = await runBridge({
  scriptPath: chromeBridgeScript,
  env: chromeEnv,
  requestPayload: {
    toolName: "render-candidate",
    args: {
      bundle: {
        files: [
          {
            path: "sections/demo-section.liquid",
            content: "<section><h2>Demo</h2><p>Example</p></section>{% schema %}{\"name\":\"Demo\",\"presets\":[{\"name\":\"Demo\"}]}{% endschema %}",
          },
        ],
      },
      viewports: ["desktop", "mobile"],
    },
  },
});

assert.equal(renderResponse.structuredContent?.status, "pass");
assert.ok(renderResponse.structuredContent?.captures?.desktop?.screenshotBase64);

const compareResponse = await runBridge({
  scriptPath: chromeBridgeScript,
  requestPayload: {
    toolName: "compare-visual",
    args: {
      inspection: { captures: inspectResponse.structuredContent.captures },
      candidate: { captures: renderResponse.structuredContent.captures },
      thresholds: {
        desktopMismatch: 0.12,
        mobileMismatch: 0.15,
      },
    },
  },
});

assert.equal(compareResponse.structuredContent?.status, "pass");
assert.equal(compareResponse.structuredContent?.perViewport?.length, 2);

const shopifyEnv = {
  HAZIFY_SECTION_SHOPIFY_DEV_UPSTREAM_COMMAND: process.execPath,
  HAZIFY_SECTION_SHOPIFY_DEV_UPSTREAM_ARGS: JSON.stringify([fakeShopifyProvider]),
  HAZIFY_SECTION_SHOPIFY_DEV_UPSTREAM_CWD: repoRoot,
  HAZIFY_SECTION_SHOPIFY_DEV_API: "liquid",
  FAKE_PROVIDER_LOG_FILE: shopifyLogPath,
};

const validateSchemaResponse = await runBridge({
  scriptPath: shopifyBridgeScript,
  env: shopifyEnv,
  requestPayload: {
    toolName: "validate-bundle-schema",
    args: {
      strict: true,
      themeContext: { templateKey: "templates/index.json" },
      bundle: {
        files: [
          {
            path: "sections/demo.liquid",
            content:
              "<section>{{ section.settings.heading }}</section>{% schema %}{\"name\":\"Demo\",\"settings\":[{\"type\":\"text\",\"id\":\"heading\",\"label\":\"Heading\"}],\"presets\":[{\"name\":\"Demo\"}]}{% endschema %}",
          },
        ],
      },
    },
  },
});

assert.equal(validateSchemaResponse.structuredContent?.status, "pass");
assert.equal(validateSchemaResponse.structuredContent?.source, "shopify-dev-mcp");

const shopifyLogAfterSchema = await fs.readFile(shopifyLogPath, "utf8");
assert.ok(shopifyLogAfterSchema.includes("learn_shopify_api"));
assert.ok(shopifyLogAfterSchema.includes("validate_theme"));

const validateTemplateResponse = await runBridge({
  scriptPath: shopifyBridgeScript,
  env: shopifyEnv,
  requestPayload: {
    toolName: "validate-template-installability",
    args: {
      strict: true,
      themeContext: {
        templateKey: "sections/index.liquid",
      },
      bundle: {
        files: [
          {
            path: "sections/demo.liquid",
            content:
              "<section>Demo</section>{% schema %}{\"name\":\"Demo\",\"presets\":[{\"name\":\"Demo\"}]}{% endschema %}",
          },
        ],
      },
    },
  },
});

assert.equal(validateTemplateResponse.structuredContent?.status, "fail");
assert.ok(
  validateTemplateResponse.structuredContent?.issues?.some(
    (entry) => entry.code === "template_insert_invalid"
  )
);

await fs.rm(tempDir, { recursive: true, force: true });
console.log("sectionProviderBridges.test.mjs passed");
