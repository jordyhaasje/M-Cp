import { normalizeAccountEmail, normalizeOptionalEmail } from "../domain/accounts.js";

function findAccountByEmail(accounts, email) {
  const normalized = normalizeAccountEmail(email);
  return (
    Object.values(accounts || {}).find(
      (entry) =>
        entry &&
        entry.status !== "disabled" &&
        typeof entry.email === "string" &&
        normalizeOptionalEmail(entry.email) === normalized
    ) || null
  );
}

function createAccountSession({
  db,
  accountId,
  req = null,
  createAccessToken,
  randomId,
  hashToken,
  nowIso,
  addDays,
  positiveNumber,
  accountSessionTtlDays,
  clientIp,
}) {
  const token = createAccessToken();
  const sessionId = randomId("acctsess");
  const ttlDays = positiveNumber(accountSessionTtlDays, 14);
  const expiresAt = addDays(nowIso(), ttlDays);
  const userAgent =
    req && typeof req.headers?.["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 300) : null;
  const rawIp = req ? clientIp(req) : "";
  const ipHash = rawIp ? hashToken(rawIp) : null;
  db.accountSessions[sessionId] = {
    sessionId,
    accountId,
    tokenHash: hashToken(token),
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastUsedAt: null,
    expiresAt,
    userAgent,
    ipHash,
  };
  return {
    sessionId,
    token,
    expiresAt,
  };
}

function resolveAccountSessionFromRequest({
  db,
  req,
  parseCookies,
  accountSessionCookie,
  hashToken,
  nowIso,
}) {
  const cookies = parseCookies(req);
  const rawToken = cookies[accountSessionCookie];
  if (!rawToken) {
    return { account: null, session: null, reason: "missing" };
  }
  const tokenHash = hashToken(rawToken);
  const session = Object.values(db.accountSessions || {}).find(
    (entry) => entry && entry.status === "active" && entry.tokenHash === tokenHash
  );
  if (!session) {
    return { account: null, session: null, reason: "invalid" };
  }
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.parse(nowIso())) {
    session.status = "expired";
    session.updatedAt = nowIso();
    return { account: null, session: null, reason: "expired" };
  }
  const account = db.accounts?.[session.accountId] || null;
  if (!account || account.status === "disabled") {
    return { account: null, session: null, reason: "account_missing" };
  }
  return { account, session, reason: null };
}

export { createAccountSession, findAccountByEmail, resolveAccountSessionFromRequest };
