import assert from "assert";
import { createMcpArtifactHandlers } from "../src/routes/mcp-artifacts.js";

const db = { mcpArtifacts: {} };
let persistCount = 0;

const json = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.payload = payload;
  return payload;
};

const nowIso = () => new Date().toISOString();

const readBody = async (req) => ({ json: req.body || {} });

const requireMcpApiKey = (req, res) => {
  if (req?.headers?.["x-mcp-api-key"] !== "mcp-test-key") {
    json(res, 401, {
      error: "unauthorized",
      message: "Missing or invalid MCP API key",
    });
    return false;
  }
  return true;
};

const handlers = createMcpArtifactHandlers({
  db,
  json,
  nowIso,
  readBody,
  persistDb: async () => {
    persistCount += 1;
  },
  requireMcpApiKey,
  maxArtifactsPerTenant: 2,
});

const makeReq = (body, headers = {}) => ({ body, headers });
const makeRes = () => ({ statusCode: 0, payload: null });

const now = nowIso();
const validArtifact = {
  artifactId: "ins_01TESTARTIFACT0000000000",
  tenantId: "tenant_test",
  type: "inspection",
  status: "pass",
  parentIds: [],
  payload: { referenceUrl: "https://example.com" },
  createdAt: now,
  updatedAt: now,
  lastAccessedAt: now,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  version: "section-workflow-v1",
};

{
  const req = makeReq({ artifact: validArtifact }, {});
  const res = makeRes();
  await handlers.handleUpsert(req, res);
  assert.equal(res.statusCode, 401, "upsert should require x-mcp-api-key");
}

{
  const req = makeReq({ artifact: validArtifact }, { "x-mcp-api-key": "mcp-test-key" });
  const res = makeRes();
  await handlers.handleUpsert(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.artifact.tenantId, "tenant_test");
}

{
  const req = makeReq(
    {
      tenantId: "tenant_test",
      artifactId: "ins_01TESTARTIFACT0000000000",
    },
    { "x-mcp-api-key": "mcp-test-key" }
  );
  const res = makeRes();
  await handlers.handleGet(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.found, true);
}

{
  const req = makeReq(
    {
      tenantId: "tenant_other",
      artifactId: "ins_01TESTARTIFACT0000000000",
    },
    { "x-mcp-api-key": "mcp-test-key" }
  );
  const res = makeRes();
  await handlers.handleGet(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.found, false, "tenant mismatch should not leak artifacts");
}

{
  const expired = {
    ...validArtifact,
    artifactId: "val_01EXPIREDARTIFACT00000000",
    tenantId: "tenant_test",
    type: "validation",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  };
  await handlers.handleUpsert(
    makeReq({ artifact: expired }, { "x-mcp-api-key": "mcp-test-key" }),
    makeRes()
  );

  const res = makeRes();
  await handlers.handleGet(
    makeReq(
      {
        tenantId: "tenant_test",
        artifactId: "val_01EXPIREDARTIFACT00000000",
      },
      { "x-mcp-api-key": "mcp-test-key" }
    ),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.found, false, "expired artifacts should be removed on read");
}

{
  const res = makeRes();
  await handlers.handlePurgeExpired(
    makeReq({ tenantId: "tenant_test" }, { "x-mcp-api-key": "mcp-test-key" }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.ok(Number.isFinite(res.payload.removed));
}

{
  const second = {
    ...validArtifact,
    artifactId: "bun_01TESTARTIFACT0000000000",
    type: "bundle",
  };
  const secondRes = makeRes();
  await handlers.handleUpsert(
    makeReq({ artifact: second }, { "x-mcp-api-key": "mcp-test-key" }),
    secondRes
  );
  assert.equal(secondRes.statusCode, 200);

  const overQuota = {
    ...validArtifact,
    artifactId: "val_01TESTARTIFACT0000000000",
    type: "validation",
  };
  const overQuotaRes = makeRes();
  await handlers.handleUpsert(
    makeReq({ artifact: overQuota }, { "x-mcp-api-key": "mcp-test-key" }),
    overQuotaRes
  );
  assert.equal(overQuotaRes.statusCode, 429, "tenant quota should block additional persistent artifacts");
  assert.equal(overQuotaRes.payload.error, "artifact_quota_exceeded");
}

{
  const res = makeRes();
  await handlers.handleDelete(
    makeReq(
      {
        tenantId: "tenant_test",
        artifactId: "ins_01TESTARTIFACT0000000000",
      },
      { "x-mcp-api-key": "mcp-test-key" }
    ),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.deleted, true);
}

assert.ok(persistCount >= 3, "upsert/get/delete flows should persist changes");

console.log("mcp-artifacts.test.mjs passed");
