import assert from "assert";
import net from "net";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
          return;
        }
        reject(new Error("Could not determine free port"));
      });
    });
    server.on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status > 0) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const issuerPath = "/oauth-public";
const dbPath = path.join(os.tmpdir(), `hazify-license-oauth-path-${Date.now()}.json`);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(testDir, "../src/server.js");

const child = spawn(process.execPath, [serverPath], {
  cwd: path.resolve(testDir, ".."),
  env: {
    ...process.env,
    PORT: String(port),
    LICENSE_DB_PATH: dbPath,
    HAZIFY_FREE_MODE: "true",
    ADMIN_API_KEY: "admin-oauth-path",
    MCP_API_KEY: "mcp-oauth-path",
    PUBLIC_BASE_URL: baseUrl,
    MCP_PUBLIC_URL: `${baseUrl}/mcp`,
    OAUTH_ISSUER: `${baseUrl}${issuerPath}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitFor(`${baseUrl}/health`);

  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server${issuerPath}`);
  assert.equal(metadataResponse.status, 200, "path-inserted authorization metadata should be reachable");
  const metadata = await metadataResponse.json();
  assert.equal(metadata.issuer, `${baseUrl}${issuerPath}`);

  const openIdResponse = await fetch(`${baseUrl}/.well-known/openid-configuration${issuerPath}`);
  assert.equal(openIdResponse.status, 200, "path-inserted openid metadata should be reachable");

  const registerResponse = await fetch(`${baseUrl}${issuerPath}/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_name: "Issuer path test client",
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  assert.equal(registerResponse.status, 201, "path-prefixed register endpoint should be reachable");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(stderr.trim(), "", stderr.trim() ? `license service stderr should stay empty:\n${stderr}` : "");
}
