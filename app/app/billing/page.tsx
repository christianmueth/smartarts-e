import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import BillingActions from "@/components/BillingActions";
import { getBillingSnapshotForClerkUser } from "@/lib/billing";

export const dynamic = "force-dynamic";

const premiumFeatures = [
  "Generate AI image references directly onto the whiteboard for moodboards, keyframes, and concept variations.",
  "Keep Stripe-backed subscription state on the account so premium assists can be enforced server-side.",
  "Use the billing portal for self-serve payment method, cancellation, and subscription management.",
];

export default async function BillingPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    redirect(`/?next=${encodeURIComponent("/app/billing")}`);
  }

  const billing = await getBillingSnapshotForClerkUser(clerkUserId);
  const statusLabel = billing.isPremium ? "Premium active" : billing.premiumStatus ? billing.premiumStatus.replace(/_/g, " ") : "Free plan";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <section className="rounded-[2rem] border border-stone-200 bg-gradient-to-br from-stone-50 via-white to-orange-50 p-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Billing</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Stripe-backed premium access for studio assists.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-700">
          Premium currently unlocks AI-generated image placement in the whiteboard studio. The subscription state is stored on your account and synchronized from Stripe webhooks.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900">
            {statusLabel}
          </span>
          {billing.premiumAccessUntil ? (
            <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
              Access through {formatDate(billing.premiumAccessUntil)}
            </span>
          ) : null}
        </div>
        <div className="mt-6">
          <BillingActions isPremium={billing.isPremium} hasBillingProfile={Boolean(billing.stripeCustomerId)} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {premiumFeatures.map((feature) => (
          <div key={feature} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm leading-7 text-slate-700">{feature}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}