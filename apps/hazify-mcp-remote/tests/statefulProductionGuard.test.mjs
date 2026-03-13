import assert from "assert";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const entryUrl = pathToFileURL(path.resolve(testDir, "../src/index.js")).href;

const childEnv = {
  ...process.env,
  NODE_ENV: "production",
  HAZIFY_MCP_TRANSPORT: "http",
  HAZIFY_MCP_HTTP_HOST: "127.0.0.1",
  PORT: "63888",
  HAZIFY_MCP_INTROSPECTION_URL: "http://127.0.0.1:65500",
  HAZIFY_MCP_API_KEY: "mcp-test-key-123456",
  MCP_SESSION_MODE: "stateful",
};
delete childEnv.MCP_STATEFUL_DEPLOYMENT_SAFE;

const result = await new Promise((resolve) => {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", `import("${entryUrl}")`],
    { env: childEnv, stdio: ["ignore", "pipe", "pipe"] }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.on("close", (code, signal) => {
    resolve({ code, signal, stdout, stderr });
  });
});

assert.equal(result.signal, null, "process should exit normally without kill signal");
assert.equal(result.code, 1, "production stateful mode without safety flag should fail fast");
assert.match(
  result.stderr,
  /stateful MCP session mode in production requires explicit confirmation/i
);

console.log("statefulProductionGuard.test.mjs passed");
