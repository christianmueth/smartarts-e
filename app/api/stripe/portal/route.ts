import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getBillingSnapshotForClerkUser } from "@/lib/billing";
import { getAppUrl, getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const billing = await getBillingSnapshotForClerkUser(clerkUserId);
    if (!billing.stripeCustomerId) {
      return NextResponse.json({ ok: false, error: "Start paid billing first before opening the billing portal." }, { status: 400 });
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: billing.stripeCustomerId,
      return_url: `${getAppUrl()}/app/billing`,
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to open the billing portal." },
      { status: 500 }
    );
  }
}