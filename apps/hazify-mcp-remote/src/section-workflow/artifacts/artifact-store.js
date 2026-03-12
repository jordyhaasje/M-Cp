export class ArtifactStore {
  async upsert(_record) {
    throw new Error("ArtifactStore.upsert not implemented");
  }

  async get(_tenantId, _artifactId) {
    throw new Error("ArtifactStore.get not implemented");
  }

  async delete(_tenantId, _artifactId) {
    throw new Error("ArtifactStore.delete not implemented");
  }

  async purgeExpired(_options = {}) {
    throw new Error("ArtifactStore.purgeExpired not implemented");
  }

  async destroy() {
    // Optional cleanup.
  }
}
