import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

process.env.NODE_ENV = "test";

const runNodeTestFile = (relativePath) => {
  execFileSync(process.execPath, ["--test", fileURLToPath(new URL(relativePath, import.meta.url))], {
    stdio: "inherit",
    env: process.env,
  });
};

await import("./urlSecurity.test.mjs");
await import("./statefulProductionGuard.test.mjs");
await import("./mcpHttpAuth.test.mjs");
await import("./mcpScopeEnforcement.test.mjs");
await import("./toolHardening.test.mjs");
await import("./toolRegistry.test.mjs");
await import("./themeFilesBatch.test.mjs");
await import("./themePlanning.test.mjs");
runNodeTestFile("./createThemeSection.test.mjs");
runNodeTestFile("./crossThemeAcceptanceMatrix.test.mjs");
await import("./remediation.test.mjs");
await import("./runtimeExecutionBehavior.test.mjs");
await import("./tenantIsolation.test.mjs");
await import("./tenantIsolationAllTools.test.mjs");
runNodeTestFile("./draftThemeArtifact.test.mjs");
console.log("All hazify tests passed");
