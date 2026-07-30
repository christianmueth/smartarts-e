import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  getBillingSnapshotForClerkUser,
  getOrCreateStripeCustomerForClerkUser,
  hasPremiumAccessFromValues,
  parsePaidBillingTier,
  syncSubscriptionFromStripe,
} from "@/lib/billing";
import { getAppUrl, getStripe, getStripePriceIdForTier } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await readRequestJson(req);
    const requestedTier = parsePaidBillingTier(body?.tier) ?? "premium";

    const billing = await getBillingSnapshotForClerkUser(clerkUserId);
    if (hasPremiumAccessFromValues(billing.premiumStatus, billing.premiumAccessUntil)) {
      if (billing.billingTier === requestedTier) {
        return NextResponse.json({ ok: false, error: `${capitalize(requestedTier)} is already active for this account.` }, { status: 409 });
      }

      if (!billing.stripeSubscriptionId) {
        return NextResponse.json({ ok: false, error: "A paid plan is already active. Use the billing portal to switch plans." }, { status: 409 });
      }

      const existingSubscription = await getStripe().subscriptions.retrieve(billing.stripeSubscriptionId);
      const existingItemId = existingSubscription.items.data[0]?.id;
      if (!existingItemId) {
        throw new Error("Stripe subscription is missing a billable item.");
      }

      const updatedSubscription = await getStripe().subscriptions.update(billing.stripeSubscriptionId, {
        items: [{ id: existingItemId, price: getStripePriceIdForTier(requestedTier) }],
        proration_behavior: "create_prorations",
        metadata: { clerkUserId, billingTier: requestedTier },
      });

      await syncSubscriptionFromStripe(updatedSubscription);

      return NextResponse.json({ ok: true, updated: true, tier: requestedTier });
    }

    const profile = await currentUser();
    const { customerId } = await getOrCreateStripeCustomerForClerkUser(clerkUserId, {
      email: profile?.primaryEmailAddress?.emailAddress ?? null,
      name: [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || profile?.username || null,
    });

    const appUrl = getAppUrl();
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getStripePriceIdForTier(requestedTier), quantity: 1 }],
      success_url: `${appUrl}/app/billing?checkout=success`,
      cancel_url: `${appUrl}/app/billing?checkout=cancelled`,
      allow_promotion_codes: true,
      client_reference_id: clerkUserId,
      metadata: { clerkUserId, billingTier: requestedTier },
      subscription_data: {
        metadata: { clerkUserId, billingTier: requestedTier },
      },
    });

    if (!session.url) {
      throw new Error("Stripe checkout session did not return a redirect URL.");
    }

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to start checkout." },
      { status: 500 }
    );
  }
}

async function readRequestJson(req: Request) {
  try {
    return await req.json() as { tier?: string };
  } catch {
    return null;
  }
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}