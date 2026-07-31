import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  getBillingSnapshotForClerkUser,
  getOrCreateStripeCustomerForClerkUser,
  hasPremiumAccessFromValues,
} from "@/lib/billing";
import { getAppUrl, getStripe, getStripePremiumPriceId } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const billing = await getBillingSnapshotForClerkUser(clerkUserId);
    if (hasPremiumAccessFromValues(billing.premiumStatus, billing.premiumAccessUntil)) {
      return NextResponse.json({ ok: false, error: "Premium is already active for this account." }, { status: 409 });
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
      line_items: [{ price: getStripePremiumPriceId(), quantity: 1 }],
      success_url: `${appUrl}/app/billing?checkout=success`,
      cancel_url: `${appUrl}/app/billing?checkout=cancelled`,
      allow_promotion_codes: true,
      client_reference_id: clerkUserId,
      metadata: { clerkUserId },
      subscription_data: {
        metadata: { clerkUserId },
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
