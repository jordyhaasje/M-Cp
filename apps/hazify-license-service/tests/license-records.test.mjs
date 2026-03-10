import assert from "assert";
import {
  applyStripeSubscriptionSnapshot,
  canonicalLicense,
  ensureLicenseRecordShape,
  ensureTenantRecordShape,
} from "../src/domain/license-records.js";

const license = ensureLicenseRecordShape({
  licenseKey: "HZY-UNIT-RECORDS",
  status: "past_due",
  pastDueSince: "2026-03-01T10:00:00.000Z",
  entitlements: null,
  maxActivations: 0,
});

assert.equal(license.maxActivations, 3, "license shape should normalize max activations");
assert.deepEqual(
  canonicalLicense(license).entitlements,
  { mutations: true, tools: {} },
  "canonical license should fill default entitlements"
);
assert.ok(canonicalLicense(license).graceUntil, "past due license should expose graceUntil");

applyStripeSubscriptionSnapshot(license, {
  id: "sub_test_1",
  customer: "cus_test_1",
  status: "active",
  current_period_start: 1_741_780_800,
  current_period_end: 1_744_454_400,
  cancel_at: null,
  canceled_at: null,
  trial_end: null,
  metadata: { plan_code: "pro" },
  items: {
    data: [
      {
        quantity: 2,
        price: {
          id: "price_test_1",
          recurring: { interval: "month" },
        },
      },
    ],
  },
});

assert.equal(license.status, "active", "stripe snapshot should normalize active status");
assert.equal(license.subscription.planCode, "pro", "plan code should come from stripe metadata");
assert.equal(license.subscription.seats, 2, "subscription quantity should map to seats");
assert.equal(license.subscription.interval, "month", "interval should come from price recurring data");

const tenant = ensureTenantRecordShape({
  tenantId: "tenant_unit_1",
  subscription: {
    seats: 0,
    metadata: null,
  },
});

assert.equal(tenant.subscription.seats, 1, "tenant shape should normalize seats");
assert.deepEqual(tenant.subscription.metadata, {}, "tenant shape should normalize metadata");

console.log("license-records.test.mjs passed");
