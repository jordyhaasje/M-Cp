import assert from "assert";
import { createPersistDbQueue } from "../src/lib/persist-db.js";

const writes = [];
let failuresRemaining = 1;
const state = { version: 0 };

const persistDb = createPersistDbQueue({
  storage: {
    async persistState(nextState) {
      writes.push(JSON.parse(JSON.stringify(nextState)));
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error("simulated write failure");
      }
    },
  },
  getState: () => state,
});

await assert.rejects(() => persistDb(), /simulated write failure/);

state.version = 1;
await persistDb();

assert.equal(writes.length, 2, "persistDb should retry after a rejected writeQueue");
assert.equal(writes[1].version, 1, "later writes should still persist the latest state");

console.log("persist-db.test.mjs passed");
