import assert from "assert";
import net from "net";
import { startLicenseServiceTestServer } from "./helpers/serviceHarness.mjs";

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

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const issuerPath = "/oauth-public";

const harness = await startLicenseServiceTestServer({
  port,
  publicBaseUrl: baseUrl,
  mcpPublicUrl: `${baseUrl}/mcp`,
  env: {
    OAUTH_ISSUER: `${baseUrl}${issuerPath}`,
  },
  cacheBuster: `oauth-path=${Date.now()}`,
});

try {
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
  await harness.cleanup();
}
