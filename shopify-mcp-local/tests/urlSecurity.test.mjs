import assert from "assert";
import { assertPublicHttpsUrl, fetchWithSafeRedirects } from "../dist/lib/urlSecurity.js";

let failed = false;
try {
  assertPublicHttpsUrl("http://example.com");
} catch {
  failed = true;
}
assert.equal(failed, true, "http should be rejected");

failed = false;
try {
  assertPublicHttpsUrl("https://localhost/test");
} catch {
  failed = true;
}
assert.equal(failed, true, "localhost should be rejected");

failed = false;
try {
  await fetchWithSafeRedirects("https://127.0.0.1/test", { timeoutMs: 1000 });
} catch {
  failed = true;
}
assert.equal(failed, true, "private IP should be rejected");

console.log("urlSecurity.test.mjs passed");
