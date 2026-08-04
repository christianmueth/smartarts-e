import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getBillingSnapshotForClerkUser } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const billing = await getBillingSnapshotForClerkUser(clerkUserId);
  return NextResponse.json({
    isPremium: billing.isPremium,
    source: billing.source,
    stripeActive: billing.stripeActive,
    googlePlayActive: billing.googlePlayActive,
    stripeStatus: billing.premiumStatus,
    googlePlayStatus: billing.googlePlaySubscriptionStatus,
    expiresAt: billing.googlePlaySubscriptionEnd ?? billing.premiumAccessUntil,
  });
}