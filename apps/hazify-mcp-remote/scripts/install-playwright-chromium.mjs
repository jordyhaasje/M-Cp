import { spawnSync } from "node:child_process";

const isTruthy = (value) => ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

const skipBrowserDownload =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1" || process.env.HAZIFY_PLAYWRIGHT_INSTALL === "0";

if (skipBrowserDownload) {
  console.log("[hazify] Skipping Playwright Chromium install (env override).");
  process.exit(0);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["playwright", "install", "chromium"];
const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "0",
};

console.log("[hazify] Installing Playwright Chromium browser binary...");
const result = spawnSync(command, args, { stdio: "inherit", env });
if (result.status === 0) {
  console.log("[hazify] Playwright Chromium install complete.");
  process.exit(0);
}

const strictInstall = Boolean(process.env.RAILWAY_ENVIRONMENT) || isTruthy(process.env.CI) || isTruthy(process.env.HAZIFY_PLAYWRIGHT_INSTALL_STRICT);
const statusCode = Number.isInteger(result.status) ? result.status : 1;

if (strictInstall) {
  console.error("[hazify] Playwright Chromium install failed in strict mode.");
  process.exit(statusCode);
}

console.warn("[hazify] Playwright Chromium install failed outside strict mode; continuing.");
process.exit(0);
