import { NextResponse } from "next/server";
import { syncCheckoutSessionToUser, syncSubscriptionFromStripe } from "@/lib/billing";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, error: "Missing Stripe signature." }, { status: 400 });
  }

  const payload = await req.text();

  try {
    const event = getStripe().webhooks.constructEvent(payload, signature, getStripeWebhookSecret());

    switch (event.type) {
      case "checkout.session.completed":
        await syncCheckoutSessionToUser(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscriptionFromStripe(event.data.object);
        break;
      default:
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Webhook handling failed." },
      { status: 400 }
    );
  }
}