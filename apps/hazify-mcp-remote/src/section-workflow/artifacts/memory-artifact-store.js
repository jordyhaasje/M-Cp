import { ArtifactStore } from "./artifact-store.js";
import { ArtifactRecordSchema } from "../contracts.js";
import { isExpiredIso } from "./artifact-ttl.js";

const compositeKey = (tenantId, artifactId) => `${tenantId}:${artifactId}`;

export class MemoryArtifactStore extends ArtifactStore {
  constructor({ maxPerTenant = 200, sweepIntervalMs = 10 * 60 * 1000 } = {}) {
    super();
    this.records = new Map();
    this.maxPerTenant = Number.isFinite(Number(maxPerTenant)) ? Math.max(1, Number(maxPerTenant)) : 200;
    this.sweepIntervalMs =
      Number.isFinite(Number(sweepIntervalMs)) && Number(sweepIntervalMs) > 0
        ? Number(sweepIntervalMs)
        : 10 * 60 * 1000;
    this.sweepTimer = setInterval(() => {
      void this.purgeExpired({ persist: false });
    }, this.sweepIntervalMs);
    if (typeof this.sweepTimer.unref === "function") {
      this.sweepTimer.unref();
    }
  }

  enforcePerTenantCap(tenantId) {
    const rows = [];
    for (const record of this.records.values()) {
      if (record.tenantId === tenantId) {
        rows.push(record);
      }
    }

    if (rows.length <= this.maxPerTenant) {
      return;
    }

    rows.sort((a, b) => Date.parse(a.lastAccessedAt) - Date.parse(b.lastAccessedAt));
    const overflow = rows.length - this.maxPerTenant;
    for (let index = 0; index < overflow; index += 1) {
      const row = rows[index];
      this.records.delete(compositeKey(row.tenantId, row.artifactId));
    }
  }

  async upsert(record) {
    const parsed = ArtifactRecordSchema.parse(record);
    this.records.set(compositeKey(parsed.tenantId, parsed.artifactId), parsed);
    this.enforcePerTenantCap(parsed.tenantId);
    return parsed;
  }

  async get(tenantId, artifactId) {
    const key = compositeKey(tenantId, artifactId);
    const record = this.records.get(key);
    if (!record) {
      return null;
    }

    if (isExpiredIso(record.expiresAt)) {
      this.records.delete(key);
      return null;
    }

    const updated = {
      ...record,
      lastAccessedAt: new Date().toISOString(),
    };
    this.records.set(key, updated);
    return updated;
  }

  async delete(tenantId, artifactId) {
    return this.records.delete(compositeKey(tenantId, artifactId));
  }

  async purgeExpired({ tenantId } = {}) {
    const now = Date.now();
    let removed = 0;

    for (const [key, record] of this.records.entries()) {
      if (tenantId && record.tenantId !== tenantId) {
        continue;
      }
      if (isExpiredIso(record.expiresAt, now)) {
        this.records.delete(key);
        removed += 1;
      }
    }

    return { removed };
  }

  async destroy() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
