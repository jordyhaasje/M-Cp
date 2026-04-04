import crypto from "crypto";
import { newDb } from "pg-mem";
import {
  clearThemeDraftTestPoolOverride,
  setThemeDraftTestPoolOverride,
} from "../../src/lib/db.js";

export function createThemeDraftDbHarness() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const advisoryLocks = new Set();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid",
    implementation: () => crypto.randomUUID(),
  });
  mem.public.registerFunction({
    name: "pg_try_advisory_lock",
    args: ["bigint"],
    returns: "bool",
    implementation: (lockKey) => {
      const normalizedKey = String(lockKey);
      if (advisoryLocks.has(normalizedKey)) {
        return false;
      }
      advisoryLocks.add(normalizedKey);
      return true;
    },
  });
  mem.public.registerFunction({
    name: "pg_advisory_unlock",
    args: ["bigint"],
    returns: "bool",
    implementation: (lockKey) => {
      const normalizedKey = String(lockKey);
      if (!advisoryLocks.has(normalizedKey)) {
        return false;
      }
      advisoryLocks.delete(normalizedKey);
      return true;
    },
  });

  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  setThemeDraftTestPoolOverride(pool);

  return {
    pool,
    async cleanup() {
      clearThemeDraftTestPoolOverride();
      await pool.end();
    },
  };
}
