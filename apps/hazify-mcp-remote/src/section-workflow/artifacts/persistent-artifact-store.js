import { ArtifactStore } from "./artifact-store.js";
import { ArtifactRecordSchema } from "../contracts.js";

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

const createPersistentError = (response, fallbackCode, fallbackMessage) => {
  const error = new Error(
    response?.payload?.message ||
      fallbackMessage ||
      `Persistent artifact request failed (${response?.status || "n/a"})`
  );
  error.code = String(response?.payload?.error || fallbackCode || "artifact_persistence_degraded");
  error.status = Number(response?.status || 0) || null;
  error.details = response?.payload || null;
  return error;
};

export class PersistentArtifactStore extends ArtifactStore {
  constructor({ baseUrl, apiKey, timeoutMs = 8000 } = {}) {
    super();
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.apiKey = String(apiKey || "").trim();
    this.timeoutMs =
      Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 8000;
  }

  get enabled() {
    return isHttpUrl(this.baseUrl) && Boolean(this.apiKey);
  }

  async post(path, payload) {
    if (!this.enabled) {
      return { disabled: true, ok: false, payload: null };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-mcp-api-key": this.apiKey,
        },
        body: JSON.stringify(payload || {}),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch (_error) {
        parsed = { error: "invalid_json", message: text };
      }

      return {
        disabled: false,
        ok: response.ok,
        status: response.status,
        payload: parsed,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async upsert(record) {
    const parsed = ArtifactRecordSchema.parse(record);
    const response = await this.post("/v1/mcp/artifacts/upsert", { artifact: parsed });
    if (!response.ok && !response.disabled) {
      throw createPersistentError(
        response,
        "artifact_persistence_degraded",
        `Persistent artifact upsert failed (${response.status || "n/a"})`
      );
    }
    return parsed;
  }

  async get(tenantId, artifactId) {
    const response = await this.post("/v1/mcp/artifacts/get", { tenantId, artifactId });
    if (response.disabled) {
      return null;
    }
    if (!response.ok) {
      throw createPersistentError(
        response,
        "artifact_persistence_degraded",
        `Persistent artifact get failed (${response.status || "n/a"})`
      );
    }
    if (!response.payload?.found) {
      return null;
    }
    return ArtifactRecordSchema.parse(response.payload.artifact);
  }

  async delete(tenantId, artifactId) {
    const response = await this.post("/v1/mcp/artifacts/delete", { tenantId, artifactId });
    if (response.disabled) {
      return false;
    }
    if (!response.ok) {
      throw createPersistentError(
        response,
        "artifact_persistence_degraded",
        `Persistent artifact delete failed (${response.status || "n/a"})`
      );
    }
    return Boolean(response.payload?.deleted);
  }

  async purgeExpired(options = {}) {
    const response = await this.post("/v1/mcp/artifacts/purge-expired", options || {});
    if (response.disabled) {
      return { removed: 0, disabled: true };
    }
    if (!response.ok) {
      throw createPersistentError(
        response,
        "artifact_persistence_degraded",
        `Persistent artifact purge failed (${response.status || "n/a"})`
      );
    }
    return {
      removed: Number(response.payload?.removed || 0),
      disabled: false,
    };
  }
}
