import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export const PAID_BILLING_TIERS = ["premium", "organization"] as const;

export type PaidBillingTier = (typeof PAID_BILLING_TIERS)[number];

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }

  return stripeClient;
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }
  return secret;
}

export function getStripePremiumPriceId() {
  const priceId = process.env.STRIPE_PREMIUM_PRICE_ID?.trim();
  if (!priceId) {
    throw new Error("STRIPE_PREMIUM_PRICE_ID is not configured.");
  }
  return priceId;
}

export function getStripeOrganizationPriceId() {
  const priceId = process.env.STRIPE_ORGANIZATION_PRICE_ID?.trim();
  if (!priceId) {
    throw new Error("STRIPE_ORGANIZATION_PRICE_ID is not configured.");
  }
  return priceId;
}

export function getStripeConfiguredPriceIds() {
  return {
    premium: process.env.STRIPE_PREMIUM_PRICE_ID?.trim() || null,
    organization: process.env.STRIPE_ORGANIZATION_PRICE_ID?.trim() || null,
  } satisfies Record<PaidBillingTier, string | null>;
}

export function getStripePriceIdForTier(tier: PaidBillingTier) {
  if (tier === "organization") {
    return getStripeOrganizationPriceId();
  }
  return getStripePremiumPriceId();
}

export function getAppUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }

  return "http://localhost:3000";
}