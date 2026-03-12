import {
  ensureMcpArtifactRecordShape,
  ensureMcpArtifactsBucket,
  isMcpArtifactExpired,
  mcpArtifactKey,
} from "../domain/mcp-artifacts.js";

const badRequest = (res, json, message) => json(res, 400, { error: "bad_request", message });

export function createMcpArtifactHandlers({
  db,
  json,
  nowIso,
  readBody,
  persistDb,
  requireMcpApiKey,
  maxArtifactsPerTenant = 2000,
}) {
  const tenantArtifactCount = (bucket, tenantId) =>
    Object.values(bucket).reduce((count, artifact) => {
      if (artifact && typeof artifact === "object" && artifact.tenantId === tenantId) {
        return count + 1;
      }
      return count;
    }, 0);

  async function handleUpsert(req, res) {
    if (!requireMcpApiKey(req, res)) {
      return;
    }

    try {
      const { json: payload } = await readBody(req);
      const artifact = ensureMcpArtifactRecordShape(payload?.artifact);
      const bucket = ensureMcpArtifactsBucket(db);
      const key = mcpArtifactKey(artifact.tenantId, artifact.artifactId);
      const exists = Boolean(bucket[key]) && bucket[key].tenantId === artifact.tenantId;
      const countForTenant = tenantArtifactCount(bucket, artifact.tenantId);
      if (!exists && countForTenant >= maxArtifactsPerTenant) {
        return json(res, 429, {
          error: "artifact_quota_exceeded",
          message: `Artifact quota per tenant overschreden (max ${maxArtifactsPerTenant}).`,
          tenantId: artifact.tenantId,
          limit: maxArtifactsPerTenant,
          current: countForTenant,
        });
      }

      bucket[mcpArtifactKey(artifact.tenantId, artifact.artifactId)] = {
        ...artifact,
        updatedAt: nowIso(),
      };
      await persistDb();
      return json(res, 200, { ok: true, artifact: bucket[mcpArtifactKey(artifact.tenantId, artifact.artifactId)] });
    } catch (error) {
      return badRequest(res, json, error instanceof Error ? error.message : String(error));
    }
  }

  async function handleGet(req, res) {
    if (!requireMcpApiKey(req, res)) {
      return;
    }

    try {
      const { json: payload } = await readBody(req);
      const tenantId = String(payload?.tenantId || "").trim();
      const artifactId = String(payload?.artifactId || "").trim();
      if (!tenantId || !artifactId) {
        return badRequest(res, json, "tenantId and artifactId are required");
      }

      const bucket = ensureMcpArtifactsBucket(db);
      const key = mcpArtifactKey(tenantId, artifactId);
      const artifact = bucket[key];
      if (!artifact || artifact.tenantId !== tenantId) {
        return json(res, 200, { found: false });
      }

      if (isMcpArtifactExpired(artifact)) {
        delete bucket[key];
        await persistDb();
        return json(res, 200, { found: false, expired: true });
      }

      artifact.lastAccessedAt = nowIso();
      artifact.updatedAt = artifact.updatedAt || artifact.lastAccessedAt;
      await persistDb();
      return json(res, 200, { found: true, artifact });
    } catch (error) {
      return badRequest(res, json, error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDelete(req, res) {
    if (!requireMcpApiKey(req, res)) {
      return;
    }

    try {
      const { json: payload } = await readBody(req);
      const tenantId = String(payload?.tenantId || "").trim();
      const artifactId = String(payload?.artifactId || "").trim();
      if (!tenantId || !artifactId) {
        return badRequest(res, json, "tenantId and artifactId are required");
      }

      const bucket = ensureMcpArtifactsBucket(db);
      const key = mcpArtifactKey(tenantId, artifactId);
      const exists = Boolean(bucket[key]) && bucket[key].tenantId === tenantId;
      if (exists) {
        delete bucket[key];
        await persistDb();
      }
      return json(res, 200, { deleted: exists });
    } catch (error) {
      return badRequest(res, json, error instanceof Error ? error.message : String(error));
    }
  }

  async function handlePurgeExpired(req, res) {
    if (!requireMcpApiKey(req, res)) {
      return;
    }

    try {
      const { json: payload } = await readBody(req);
      const tenantId = typeof payload?.tenantId === "string" && payload.tenantId.trim() ? payload.tenantId.trim() : null;
      const bucket = ensureMcpArtifactsBucket(db);
      let removed = 0;

      for (const [key, artifact] of Object.entries(bucket)) {
        if (!artifact || typeof artifact !== "object") {
          delete bucket[key];
          removed += 1;
          continue;
        }
        if (tenantId && artifact.tenantId !== tenantId) {
          continue;
        }
        if (isMcpArtifactExpired(artifact)) {
          delete bucket[key];
          removed += 1;
        }
      }

      if (removed > 0) {
        await persistDb();
      }
      return json(res, 200, { removed });
    } catch (error) {
      return badRequest(res, json, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    handleUpsert,
    handleGet,
    handleDelete,
    handlePurgeExpired,
  };
}
