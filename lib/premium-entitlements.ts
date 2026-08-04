const STRIPE_ACTIVE_STATUSES = new Set(["active", "trialing"]);
const GOOGLE_PLAY_ACTIVE_STATUS = "ACTIVE";

export type PremiumEntitlementInput = {
  premiumStatus?: string | null;
  premiumAccessUntil?: Date | string | null;
  googlePlaySubscriptionStatus?: string | null;
  googlePlaySubscriptionEnd?: Date | string | null;
};

function hasFutureDate(value: Date | string | null | undefined, now = Date.now()) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > now;
}

export function hasStripePremiumAccessFromValues(status: string | null | undefined, accessUntil: Date | string | null | undefined) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  return STRIPE_ACTIVE_STATUSES.has(normalizedStatus) || hasFutureDate(accessUntil);
}

export function hasGooglePlayPremiumAccessFromValues(status: string | null | undefined, accessUntil: Date | string | null | undefined) {
  return String(status || "").trim().toUpperCase() === GOOGLE_PLAY_ACTIVE_STATUS && hasFutureDate(accessUntil);
}

export function getPremiumEntitlements(values: PremiumEntitlementInput) {
  const stripeActive = hasStripePremiumAccessFromValues(values.premiumStatus, values.premiumAccessUntil);
  const googlePlayActive = hasGooglePlayPremiumAccessFromValues(
    values.googlePlaySubscriptionStatus,
    values.googlePlaySubscriptionEnd
  );

  return {
    isPremium: stripeActive || googlePlayActive,
    stripeActive,
    googlePlayActive,
    source: stripeActive && googlePlayActive ? "both" : stripeActive ? "stripe" : googlePlayActive ? "google_play" : "none",
  } as const;
}