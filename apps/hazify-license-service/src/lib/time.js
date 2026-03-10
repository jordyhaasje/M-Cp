function nowIso() {
  return new Date().toISOString();
}

function addHours(iso, hours) {
  const base = Date.parse(iso || nowIso());
  return new Date(base + hours * 60 * 60 * 1000).toISOString();
}

function addDays(iso, days) {
  const base = Date.parse(iso || nowIso());
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

function addSeconds(iso, seconds) {
  const base = Date.parse(iso || nowIso());
  return new Date(base + seconds * 1000).toISOString();
}

function unixToIso(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return new Date(numeric * 1000).toISOString();
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export { addDays, addHours, addSeconds, nowIso, positiveNumber, unixToIso };
