import assert from "assert";
import { generateArtifactId, parseArtifactTypeFromId } from "../src/section-workflow/artifacts/artifact-id.js";
import { expiresAtIso, isExpiredIso, resolveArtifactTtlConfig } from "../src/section-workflow/artifacts/artifact-ttl.js";
import { MemoryArtifactStore } from "../src/section-workflow/artifacts/memory-artifact-store.js";
import { HybridArtifactStore } from "../src/section-workflow/artifacts/hybrid-artifact-store.js";

class FakePersistentStore {
  constructor() {
    this.records = new Map();
    this.upserts = 0;
    this.purges = 0;
  }

  key(tenantId, artifactId) {
    return `${tenantId}:${artifactId}`;
  }

  async upsert(record) {
    this.upserts += 1;
    this.records.set(this.key(record.tenantId, record.artifactId), { ...record });
    return record;
  }

  async get(tenantId, artifactId) {
    return this.records.get(this.key(tenantId, artifactId)) || null;
  }

  async delete(tenantId, artifactId) {
    return this.records.delete(this.key(tenantId, artifactId));
  }

  async purgeExpired() {
    this.purges += 1;
    return { removed: 0, disabled: false };
  }
}

const id = generateArtifactId("inspection");
assert.match(id, /^ins_[0-9A-HJKMNP-TV-Z]{26}$/);
assert.equal(parseArtifactTypeFromId(id), "inspection");
assert.equal(parseArtifactTypeFromId(generateArtifactId("bundle")), "bundle");
assert.equal(parseArtifactTypeFromId("unknown"), null);

const ttlConfig = resolveArtifactTtlConfig({
  HAZIFY_SECTION_ARTIFACT_TTL_INSPECTION_MS: "60000",
  HAZIFY_SECTION_ARTIFACT_TTL_BUNDLE_MS: "120000",
  HAZIFY_SECTION_ARTIFACT_TTL_VALIDATION_MS: "180000",
  HAZIFY_SECTION_ARTIFACT_TTL_IMPORT_MS: "240000",
});
assert.equal(ttlConfig.inspection, 60000);
assert.equal(isExpiredIso(new Date(Date.now() - 1000).toISOString()), true);
assert.equal(isExpiredIso(new Date(Date.now() + 1000).toISOString()), false);

const memoryStore = new MemoryArtifactStore({ maxPerTenant: 2, sweepIntervalMs: 60000 });

try {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  const expired = new Date(Date.now() - 60_000).toISOString();

  await memoryStore.upsert({
    artifactId: "ins_old",
    tenantId: "tenant_a",
    type: "inspection",
    status: "pass",
    parentIds: [],
    payload: {},
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    expiresAt: future,
    version: "section-workflow-v1",
  });
  await memoryStore.upsert({
    artifactId: "ins_new",
    tenantId: "tenant_a",
    type: "inspection",
    status: "pass",
    parentIds: [],
    payload: {},
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: new Date(Date.now() + 1000).toISOString(),
    expiresAt: future,
    version: "section-workflow-v1",
  });
  await memoryStore.upsert({
    artifactId: "ins_latest",
    tenantId: "tenant_a",
    type: "inspection",
    status: "pass",
    parentIds: [],
    payload: {},
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: new Date(Date.now() + 2000).toISOString(),
    expiresAt: future,
    version: "section-workflow-v1",
  });

  const evicted = await memoryStore.get("tenant_a", "ins_old");
  assert.equal(evicted, null, "oldest artifact should be evicted when tenant cap is exceeded");
  assert.ok(await memoryStore.get("tenant_a", "ins_latest"));

  await memoryStore.upsert({
    artifactId: "ins_expired",
    tenantId: "tenant_a",
    type: "inspection",
    status: "pass",
    parentIds: [],
    payload: {},
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    expiresAt: expired,
    version: "section-workflow-v1",
  });
  assert.equal(await memoryStore.get("tenant_a", "ins_expired"), null, "expired artifacts should lazy-expire on read");
  assert.equal(await memoryStore.get("tenant_b", "ins_latest"), null, "tenant scoping should be strict");
} finally {
  await memoryStore.destroy();
}

const hybridMemory = new MemoryArtifactStore({ maxPerTenant: 10, sweepIntervalMs: 60000 });
const fakePersistent = new FakePersistentStore();
const hybrid = new HybridArtifactStore({
  memoryStore: hybridMemory,
  persistentStore: fakePersistent,
});

try {
  const now = new Date().toISOString();
  const artifact = {
    artifactId: "bun_test",
    tenantId: "tenant_h",
    type: "bundle",
    status: "pass",
    parentIds: [],
    payload: { foo: "bar" },
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    expiresAt: expiresAtIso({ type: "bundle", ttlConfig }),
    version: "section-workflow-v1",
  };
  await hybrid.upsert(artifact);
  assert.equal(fakePersistent.upserts, 1);

  fakePersistent.upsert = async () => {
    const error = new Error("Tenant artifact quota exceeded");
    error.code = "artifact_quota_exceeded";
    throw error;
  };

  await assert.rejects(
    () =>
      hybrid.upsert({
        ...artifact,
        artifactId: "bun_over_quota",
      }),
    /quota exceeded/i
  );

  await hybridMemory.delete("tenant_h", "bun_test");
  const fromPersistent = await hybrid.get("tenant_h", "bun_test");
  assert.ok(fromPersistent, "hybrid store should read-through from persistent layer");

  hybrid.startPersistentPurgeLoop(20);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.ok(fakePersistent.purges >= 1, "hybrid store should trigger periodic persistent purges");
} finally {
  await hybrid.destroy();
}

console.log("sectionWorkflowArtifacts.test.mjs passed");
