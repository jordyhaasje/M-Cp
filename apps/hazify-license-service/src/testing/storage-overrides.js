let testPoolOverride = null;

export function setLicenseServiceTestPoolOverride(pool) {
  testPoolOverride = pool || null;
}

export function getLicenseServiceTestPoolOverride() {
  return testPoolOverride;
}

export function clearLicenseServiceTestPoolOverride() {
  testPoolOverride = null;
}
