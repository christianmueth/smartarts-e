import type Stripe from "stripe";
import { prisma, safeUpsertUser } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

const PREMIUM_ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function hasPremiumAccessFromValues(status: string | null | undefined, accessUntil: Date | string | null | undefined) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (PREMIUM_ACTIVE_STATUSES.has(normalizedStatus)) {
    return true;
  }

  if (!accessUntil) {
    return false;
  }

  const end = accessUntil instanceof Date ? accessUntil : new Date(accessUntil);
  return Number.isFinite(end.getTime()) && end.getTime() > Date.now();
}

export async function getBillingSnapshotForClerkUser(clerkUserId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: {
      premiumStatus: true,
      premiumAccessUntil: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
    },
  });

  const premiumStatus = user?.premiumStatus ?? null;
  const premiumAccessUntil = user?.premiumAccessUntil ?? null;

  return {
    premiumStatus,
    premiumAccessUntil,
    stripeCustomerId: user?.stripeCustomerId ?? null,
    stripeSubscriptionId: user?.stripeSubscriptionId ?? null,
    stripePriceId: user?.stripePriceId ?? null,
    isPremium: hasPremiumAccessFromValues(premiumStatus, premiumAccessUntil),
  };
}

export async function getOrCreateStripeCustomerForClerkUser(clerkUserId: string, profile?: { email?: string | null; name?: string | null }) {
  const user = await safeUpsertUser(clerkUserId, { id: true, stripeCustomerId: true });
  if (!user) {
    throw new Error("User persistence is unavailable.");
  }

  if (user.stripeCustomerId) {
    return { userId: user.id, customerId: user.stripeCustomerId };
  }

  const customer = await getStripe().customers.create({
    email: cleanString(profile?.email) || undefined,
    name: cleanString(profile?.name) || undefined,
    metadata: { clerkUserId },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
    select: { id: true },
  });

  return { userId: user.id, customerId: customer.id };
}

export async function syncCheckoutSessionToUser(session: Stripe.Checkout.Session) {
  const clerkUserId = cleanString(session.metadata?.clerkUserId);
  const customerId = getCustomerId(session.customer);

  if (clerkUserId) {
    const user = await safeUpsertUser(clerkUserId, { id: true });
    if (user && customerId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
        select: { id: true },
      });
    }
  }

  if (session.subscription) {
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    await syncSubscriptionFromStripe(subscription);
  }
}

export async function syncSubscriptionFromStripe(subscription: Stripe.Subscription) {
  const customerId = getCustomerId(subscription.customer);
  const clerkUserId = cleanString(subscription.metadata?.clerkUserId) || await resolveClerkUserId(customerId);
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const premiumAccessUntil = typeof subscription.current_period_end === "number"
    ? new Date(subscription.current_period_end * 1000)
    : null;

  const data = {
    stripeCustomerId: customerId || undefined,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    premiumStatus: subscription.status,
    premiumAccessUntil,
  };

  if (clerkUserId) {
    const user = await safeUpsertUser(clerkUserId, { id: true });
    if (!user) {
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data,
      select: { id: true },
    });
    return;
  }

  if (customerId) {
    await prisma.user.updateMany({
      where: { stripeCustomerId: customerId },
      data,
    });
  }
}

async function resolveClerkUserId(customerId: string | null) {
  if (!customerId) {
    return "";
  }

  const existingUser = await prisma.user.findFirst({
    where: { stripeCustomerId: customerId },
    select: { clerkUserId: true },
  });
  if (existingUser?.clerkUserId) {
    return existingUser.clerkUserId;
  }

  try {
    const customer = await getStripe().customers.retrieve(customerId);
    if (!("deleted" in customer) || customer.deleted) {
      return "";
    }
    return cleanString(customer.metadata?.clerkUserId);
  } catch {
    return "";
  }
}

function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  if (!customer) {
    return null;
  }
  if (typeof customer === "string") {
    return customer;
  }
  if ("deleted" in customer && customer.deleted) {
    return customer.id;
  }
  return customer.id;
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}