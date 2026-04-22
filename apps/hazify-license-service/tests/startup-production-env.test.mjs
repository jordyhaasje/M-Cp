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
        reject(new Error("Failed to determine free port"));
      });
    });
    server.on("error", reject);
  });
}

const port = await getFreePort();

await assert.rejects(
  () =>
    startLicenseServiceTestServer({
      port,
      publicBaseUrl: `http://127.0.0.1:${port}`,
      mcpPublicUrl: `http://127.0.0.1:${port}/mcp`,
      env: {
        NODE_ENV: "development",
        RAILWAY_ENVIRONMENT_NAME: "production",
        DATA_ENCRYPTION_KEY: "",
        BACKUP_EXPORT_KEY: "",
        BACKUP_EXPORT_DIRECTORY: "",
        BACKUP_EXPORT_POLICY: "",
        HAZIFY_FREE_MODE: "false",
      },
      cacheBuster: `startup-prod=${Date.now()}`,
    }),
  /DATA_ENCRYPTION_KEY is verplicht in productie\./,
  "production startup should fail when mandatory envs are missing even if NODE_ENV is wrong"
);

const successPort = await getFreePort();
const productionHarness = await startLicenseServiceTestServer({
  port: successPort,
  publicBaseUrl: `http://127.0.0.1:${successPort}`,
  mcpPublicUrl: `http://127.0.0.1:${successPort}/mcp`,
  env: {
    NODE_ENV: "development",
    RAILWAY_ENVIRONMENT_NAME: "production",
    DATA_ENCRYPTION_KEY: "license-service-test-encryption-key",
    BACKUP_EXPORT_KEY: "",
    BACKUP_EXPORT_DIRECTORY: "",
    BACKUP_EXPORT_POLICY: "",
    HAZIFY_FREE_MODE: "false",
    DB_SINGLE_WRITER_ENFORCED: "true",
  },
  cacheBuster: `startup-prod-success=${Date.now()}`,
});

try {
  assert.equal(
    productionHarness.server.listening,
    true,
    "production startup should still succeed when backup export is simply not configured"
  );
} finally {
  await productionHarness.cleanup();
}

console.log("startup-production-env.test.mjs passed");
