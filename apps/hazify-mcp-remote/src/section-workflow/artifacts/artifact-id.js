import crypto from "crypto";

const PREFIX_BY_TYPE = Object.freeze({
  inspection: "ins",
  bundle: "bun",
  validation: "val",
  import: "imp",
});

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const artifactPrefixForType = (type) => PREFIX_BY_TYPE[type] || "art";

const encodeBase32 = (value, length) => {
  let remaining = Number(value);
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD_BASE32[remaining % 32] + output;
    remaining = Math.floor(remaining / 32);
  }
  return output;
};

const randomBase32 = (length) => {
  let output = "";
  while (output.length < length) {
    const byte = crypto.randomBytes(1)[0];
    output += CROCKFORD_BASE32[byte % 32];
  }
  return output.slice(0, length);
};

export const generateUlid = (timestampMs = Date.now()) =>
  `${encodeBase32(Math.max(0, Math.floor(timestampMs)), 10)}${randomBase32(16)}`;

export const generateArtifactId = (type) => {
  const prefix = artifactPrefixForType(type);
  return `${prefix}_${generateUlid()}`;
};

export const parseArtifactTypeFromId = (artifactId) => {
  const raw = String(artifactId || "").trim();
  if (!raw.includes("_")) {
    return null;
  }
  const prefix = raw.split("_")[0];
  const entry = Object.entries(PREFIX_BY_TYPE).find(([, value]) => value === prefix);
  return entry ? entry[0] : null;
};
