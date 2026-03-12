import { ArtifactStore } from "./artifact-store.js";
import { MemoryArtifactStore } from "./memory-artifact-store.js";
import { PersistentArtifactStore } from "./persistent-artifact-store.js";

export class HybridArtifactStore extends ArtifactStore {
  constructor({ memoryStore, persistentStore } = {}) {
    super();
    this.memoryStore = memoryStore || new MemoryArtifactStore();
    this.persistentStore = persistentStore || new PersistentArtifactStore();
    this.purgeTimer = null;
  }

  startPersistentPurgeLoop(intervalMs = 60 * 60 * 1000) {
    const safeInterval =
      Number.isFinite(Number(intervalMs)) && Number(intervalMs) > 0 ? Number(intervalMs) : 60 * 60 * 1000;

    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
    }

    this.purgeTimer = setInterval(() => {
      void this.persistentStore.purgeExpired().catch(() => {
        // Best-effort cleanup.
      });
    }, safeInterval);

    if (typeof this.purgeTimer.unref === "function") {
      this.purgeTimer.unref();
    }
  }

  async upsert(record) {
    const saved = await this.memoryStore.upsert(record);
    try {
      await this.persistentStore.upsert(saved);
    } catch (error) {
      if (String(error?.code || "").trim().toLowerCase() === "artifact_quota_exceeded") {
        throw error;
      }
      // Degraded mode: memory remains source of truth for current process.
    }
    return saved;
  }

  async get(tenantId, artifactId) {
    const memoryHit = await this.memoryStore.get(tenantId, artifactId);
    if (memoryHit) {
      return memoryHit;
    }

    try {
      const persistentHit = await this.persistentStore.get(tenantId, artifactId);
      if (!persistentHit) {
        return null;
      }
      await this.memoryStore.upsert(persistentHit);
      return persistentHit;
    } catch (_error) {
      return null;
    }
  }

  async delete(tenantId, artifactId) {
    const deletedFromMemory = await this.memoryStore.delete(tenantId, artifactId);
    try {
      await this.persistentStore.delete(tenantId, artifactId);
    } catch (_error) {
      // Ignore persistent delete failures.
    }
    return deletedFromMemory;
  }

  async purgeExpired(options = {}) {
    const memory = await this.memoryStore.purgeExpired(options);
    let persistent = { removed: 0, disabled: true };
    try {
      persistent = await this.persistentStore.purgeExpired(options);
    } catch (_error) {
      persistent = { removed: 0, disabled: false, failed: true };
    }
    return {
      removed: Number(memory.removed || 0) + Number(persistent.removed || 0),
      memory,
      persistent,
    };
  }

  async destroy() {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }
    await this.memoryStore.destroy();
  }
}
