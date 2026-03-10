import crypto from "crypto";

function normalizeOptionalEmail(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("contactEmail must be a valid email address");
  }
  return normalized;
}

function normalizeAccountEmail(value) {
  const normalized = normalizeOptionalEmail(value);
  if (!normalized) {
    throw new Error("email is required");
  }
  return normalized;
}

function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString("hex");
}

function safeTimingEqual(a, b) {
  const aBuf = Buffer.from(String(a), "utf8");
  const bBuf = Buffer.from(String(b), "utf8");
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createPasswordDigest(password) {
  const value = typeof password === "string" ? password : "";
  if (value.length < 10) {
    throw new Error("Gebruik een wachtwoord van minimaal 10 tekens.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    salt,
    hash: passwordHash(value, salt),
  };
}

function verifyPasswordDigest(password, salt, expectedHash) {
  const digest = passwordHash(password, salt);
  return safeTimingEqual(digest, expectedHash);
}

function accountPublicPayload(account) {
  return {
    accountId: account.accountId,
    name: account.name,
    email: account.email,
    licenseKey: account.licenseKey,
    createdAt: account.createdAt || null,
    updatedAt: account.updatedAt || null,
    lastLoginAt: account.lastLoginAt || null,
  };
}

export {
  accountPublicPayload,
  createPasswordDigest,
  normalizeAccountEmail,
  normalizeOptionalEmail,
  verifyPasswordDigest,
};
