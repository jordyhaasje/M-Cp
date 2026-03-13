import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const storagePath = path.resolve(testDir, "../src/repositories/postgres-storage.js");
const source = await fs.readFile(storagePath, "utf8");

assert.equal(
  source.includes("TRUNCATE TABLE"),
  false,
  "Postgres persistence must not use destructive TRUNCATE + full reinsert"
);
assert.equal(
  source.includes("ON CONFLICT"),
  true,
  "Postgres persistence should use per-entity upserts"
);
assert.equal(
  source.includes("deleteByIds("),
  true,
  "Postgres persistence should delete removed records per entity"
);

console.log("storage-safety.test.mjs passed");
