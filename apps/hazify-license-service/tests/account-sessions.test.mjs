import assert from "assert";
import crypto from "crypto";
import {
  createAccountSession,
  findAccountByEmail,
  resolveAccountSessionFromRequest,
} from "../src/services/account-sessions.js";

const hashToken = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");

const accounts = {
  acct_active: {
    accountId: "acct_active",
    email: "owner@example.com",
    status: "active",
  },
  acct_disabled: {
    accountId: "acct_disabled",
    email: "disabled@example.com",
    status: "disabled",
  },
};

assert.equal(findAccountByEmail(accounts, " Owner@Example.com ")?.accountId, "acct_active");
assert.equal(findAccountByEmail(accounts, "disabled@example.com"), null);

const db = {
  accounts: {
    acct_active: {
      accountId: "acct_active",
      email: "owner@example.com",
      status: "active",
    },
  },
  accountSessions: {},
};

const created = createAccountSession({
  db,
  accountId: "acct_active",
  req: {
    headers: { "user-agent": "Mozilla/5.0 test agent" },
  },
  createAccessToken: () => "hzacct_token_1",
  randomId: (prefix) => `${prefix}_1`,
  hashToken,
  nowIso: () => "2026-03-10T12:00:00.000Z",
  addDays: () => "2026-03-24T12:00:00.000Z",
  positiveNumber: (value, fallback) => Number(value || fallback),
  accountSessionTtlDays: 14,
  clientIp: () => "127.0.0.1",
});

assert.equal(created.sessionId, "acctsess_1");
assert.equal(created.token, "hzacct_token_1");
assert.equal(created.expiresAt, "2026-03-24T12:00:00.000Z");
assert.equal(db.accountSessions.acctsess_1.accountId, "acct_active");
assert.equal(db.accountSessions.acctsess_1.tokenHash, hashToken("hzacct_token_1"));
assert.equal(db.accountSessions.acctsess_1.ipHash, hashToken("127.0.0.1"));

assert.deepEqual(
  resolveAccountSessionFromRequest({
    db,
    req: { headers: {} },
    parseCookies: () => ({}),
    accountSessionCookie: "hz_user_session",
    hashToken,
    nowIso: () => "2026-03-10T12:00:00.000Z",
  }),
  { account: null, session: null, reason: "missing" }
);

assert.deepEqual(
  resolveAccountSessionFromRequest({
    db,
    req: { headers: {} },
    parseCookies: () => ({ hz_user_session: "wrong" }),
    accountSessionCookie: "hz_user_session",
    hashToken,
    nowIso: () => "2026-03-10T12:00:00.000Z",
  }),
  { account: null, session: null, reason: "invalid" }
);

const activeResolved = resolveAccountSessionFromRequest({
  db,
  req: { headers: {} },
  parseCookies: () => ({ hz_user_session: "hzacct_token_1" }),
  accountSessionCookie: "hz_user_session",
  hashToken,
  nowIso: () => "2026-03-10T12:00:00.000Z",
});
assert.equal(activeResolved.reason, null);
assert.equal(activeResolved.account?.accountId, "acct_active");
assert.equal(activeResolved.session?.sessionId, "acctsess_1");

db.accountSessions.acctsess_1.expiresAt = "2026-03-01T12:00:00.000Z";
const expiredResolved = resolveAccountSessionFromRequest({
  db,
  req: { headers: {} },
  parseCookies: () => ({ hz_user_session: "hzacct_token_1" }),
  accountSessionCookie: "hz_user_session",
  hashToken,
  nowIso: () => "2026-03-10T12:00:00.000Z",
});
assert.equal(expiredResolved.reason, "expired");
assert.equal(db.accountSessions.acctsess_1.status, "expired");

db.accountSessions.acctsess_1.status = "active";
db.accountSessions.acctsess_1.expiresAt = "2026-03-24T12:00:00.000Z";
db.accounts.acct_active.status = "disabled";
const missingAccountResolved = resolveAccountSessionFromRequest({
  db,
  req: { headers: {} },
  parseCookies: () => ({ hz_user_session: "hzacct_token_1" }),
  accountSessionCookie: "hz_user_session",
  hashToken,
  nowIso: () => "2026-03-10T12:00:00.000Z",
});
assert.equal(missingAccountResolved.reason, "account_missing");

console.log("account-sessions.test.mjs passed");
