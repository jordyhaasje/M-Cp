import fs from "fs/promises";
import path from "path";

function initialState() {
  return {
    licenses: {},
    tenants: {},
    mcpTokens: {},
    oauthClients: {},
    oauthAuthCodes: {},
    oauthRefreshTokens: {},
    accounts: {},
    accountSessions: {},
  };
}

export class JsonStorage {
  constructor({ dbPath }) {
    this.dbPath = dbPath;
  }

  async init() {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
  }

  async loadState() {
    try {
      const raw = await fs.readFile(this.dbPath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        ...initialState(),
        ...(parsed && typeof parsed === "object" ? parsed : {}),
      };
    } catch {
      const state = initialState();
      await fs.writeFile(this.dbPath, JSON.stringify(state, null, 2));
      return state;
    }
  }

  async persistState(state) {
    const tempPath = `${this.dbPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2));
    await fs.rename(tempPath, this.dbPath);
  }

  async exportSnapshot() {
    return this.loadState();
  }

  async close() {
    // noop
  }
}

export function createInitialState() {
  return initialState();
}
