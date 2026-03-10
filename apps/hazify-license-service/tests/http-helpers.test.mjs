import assert from "assert";
import {
  buildCookieHeader,
  isRequestSecure,
  parseCookies,
  safeRedirectPath,
} from "../src/lib/http.js";

assert.equal(safeRedirectPath("/dashboard?tab=1", "/fallback"), "/dashboard?tab=1");
assert.equal(safeRedirectPath("https://evil.test", "/fallback"), "/fallback");
assert.equal(safeRedirectPath("//evil.test", "/fallback"), "/fallback");

assert.deepEqual(
  parseCookies({ headers: { cookie: "a=1; token=hello%20world" } }),
  { a: "1", token: "hello world" }
);
assert.deepEqual(parseCookies({ headers: {} }), {});

assert.equal(
  buildCookieHeader("sid", "abc 123", { maxAgeSeconds: 60, secure: true }),
  "sid=abc%20123; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure"
);

assert.equal(
  isRequestSecure({ headers: { "x-forwarded-proto": "https" }, socket: { encrypted: false } }),
  true
);
assert.equal(isRequestSecure({ headers: {}, socket: { encrypted: true } }), true);
assert.equal(isRequestSecure({ headers: {}, socket: { encrypted: false } }), false);

console.log("http-helpers.test.mjs passed");
