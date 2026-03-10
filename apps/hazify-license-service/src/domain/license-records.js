import { VALID_LICENSE_STATUSES, config } from "../config/runtime.js";
import { addDays, addHours, nowIso, positiveNumber, unixToIso } from "../lib/time.js";

function defaultEntitlements() {
  return { mutations: true, tools: {} };
}

function defaultLicenseSubscription(record = {}) {
  return {
    provider: "stripe",
    status: record.stripeSubscriptionId ? "linked" : "inactive",
    planCode: null,
    priceId: null,
    interval: null,
    seats: 1,
    customerId: record.stripeCustomerId || null,
    subscriptionId: record.stripeSubscriptionId || null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAt: null,
    canceledAt: record.canceledAt || null,
    trialEndsAt: null,
    metadata: {},
  };
}

function ensureLicenseRecordShape(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  record.entitlements =
    record.entitlements && typeof record.entitlements === "object"
      ? record.entitlements
      : defaultEntitlements();
  record.maxActivations = positiveNumber(record.maxActivations, 3);
  record.boundFingerprints = Array.isArray(record.boundFingerprints) ? record.boundFingerprints : [];
  record.stripeCustomerId =
    typeof record.stripeCustomerId === "string" && record.stripeCustomerId.trim()
      ? record.stripeCustomerId.trim()
      : null;
  record.stripeSubscriptionId =
    typeof record.stripeSubscriptionId === "string" && record.stripeSubscriptionId.trim()
      ? record.stripeSubscriptionId.trim()
      : null;

  if (!record.subscription || typeof record.subscription !== "object") {
    record.subscription = defaultLicenseSubscription(record);
  } else {
    const merged = { ...defaultLicenseSubscription(record), ...record.subscription };
    merged.provider =
      typeof merged.provider === "string" && merged.provider.trim() ? merged.provider.trim() : "stripe";
    merged.status =
      typeof merged.status === "string" && merged.status.trim() ? merged.status.trim() : "inactive";
    merged.seats = positiveNumber(merged.seats, 1);
    merged.customerId =
      typeof merged.customerId === "string" && merged.customerId.trim()
        ? merged.customerId.trim()
        : record.stripeCustomerId;
    merged.subscriptionId =
      typeof merged.subscriptionId === "string" && merged.subscriptionId.trim()
        ? merged.subscriptionId.trim()
        : record.stripeSubscriptionId;
    merged.metadata = merged.metadata && typeof merged.metadata === "object" ? merged.metadata : {};
    record.subscription = merged;
  }

  if (!record.stripeCustomerId && record.subscription.customerId) {
    record.stripeCustomerId = record.subscription.customerId;
  }
  if (!record.stripeSubscriptionId && record.subscription.subscriptionId) {
    record.stripeSubscriptionId = record.subscription.subscriptionId;
  }
  return record;
}

function defaultTenantSubscriptionProfile() {
  return {
    provider: "stripe",
    status: "inactive",
    planCode: null,
    priceId: null,
    interval: null,
    seats: 1,
    nextRenewalAt: null,
    cancelAt: null,
    metadata: {},
  };
}

function ensureTenantRecordShape(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  if (!record.subscription || typeof record.subscription !== "object") {
    record.subscription = defaultTenantSubscriptionProfile();
  } else {
    const merged = { ...defaultTenantSubscriptionProfile(), ...record.subscription };
    merged.provider =
      typeof merged.provider === "string" && merged.provider.trim() ? merged.provider.trim() : "stripe";
    merged.status =
      typeof merged.status === "string" && merged.status.trim() ? merged.status.trim() : "inactive";
    merged.seats = positiveNumber(merged.seats, 1);
    merged.metadata = merged.metadata && typeof merged.metadata === "object" ? merged.metadata : {};
    record.subscription = merged;
  }
  return record;
}

function isLicenseUsableForOnboarding(record) {
  if (!record) {
    return false;
  }
  const status = VALID_LICENSE_STATUSES.has(record.status) ? record.status : "invalid";
  return status !== "invalid";
}

function canonicalLicense(record) {
  ensureLicenseRecordShape(record);
  const status = VALID_LICENSE_STATUSES.has(record.status) ? record.status : "invalid";
  const payload = {
    status,
    entitlements: record.entitlements || { mutations: true, tools: {} },
    expiresAt: record.expiresAt || null,
    graceUntil: null,
    readOnlyGraceUntil: null,
    subscription: record.subscription || defaultLicenseSubscription(record),
  };
  if (status === "past_due") {
    const start = record.pastDueSince || nowIso();
    payload.graceUntil = addHours(start, config.licenseGraceHours);
  }
  if (status === "canceled" || status === "unpaid") {
    const start = record.canceledAt || nowIso();
    payload.readOnlyGraceUntil = addDays(start, config.readOnlyGraceDays);
  }
  return payload;
}

function mapStripeStatus(status) {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "incomplete":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "invalid";
  }
}

function applyStripeSubscriptionSnapshot(record, object = {}) {
  ensureLicenseRecordShape(record);
  const status = mapStripeStatus(object.status);
  const subscriptionItem = Array.isArray(object.items?.data) ? object.items.data[0] : null;
  const price = subscriptionItem?.price || null;

  record.status = status;
  record.stripeCustomerId = object.customer || record.stripeCustomerId || null;
  record.stripeSubscriptionId = object.id || record.stripeSubscriptionId || null;
  record.subscription.provider = "stripe";
  record.subscription.status = status;
  record.subscription.customerId = record.stripeCustomerId;
  record.subscription.subscriptionId = record.stripeSubscriptionId;
  record.subscription.planCode =
    typeof object.metadata?.plan_code === "string" && object.metadata.plan_code.trim()
      ? object.metadata.plan_code.trim()
      : record.subscription.planCode;
  record.subscription.priceId = price?.id || record.subscription.priceId || null;
  record.subscription.interval = price?.recurring?.interval || record.subscription.interval || null;
  record.subscription.seats = positiveNumber(
    subscriptionItem?.quantity || record.subscription.seats || 1,
    1
  );
  record.subscription.currentPeriodStart = unixToIso(object.current_period_start);
  record.subscription.currentPeriodEnd = unixToIso(object.current_period_end);
  record.subscription.cancelAt = unixToIso(object.cancel_at);
  record.subscription.canceledAt = unixToIso(object.canceled_at) || record.canceledAt || null;
  record.subscription.trialEndsAt = unixToIso(object.trial_end);
  record.subscription.metadata =
    object.metadata && typeof object.metadata === "object"
      ? object.metadata
      : record.subscription.metadata || {};
}

export {
  applyStripeSubscriptionSnapshot,
  canonicalLicense,
  defaultEntitlements,
  defaultLicenseSubscription,
  defaultTenantSubscriptionProfile,
  ensureLicenseRecordShape,
  ensureTenantRecordShape,
  isLicenseUsableForOnboarding,
  mapStripeStatus,
};
