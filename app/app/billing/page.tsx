import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import BillingActions from "@/components/BillingActions";
import { getBillingSnapshotForClerkUser } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    redirect(`/?next=${encodeURIComponent("/app/billing")}`);
  }

  const billing = await getBillingSnapshotForClerkUser(clerkUserId);
  const statusLabel = billing.isPremium ? "Premium active" : "Free plan";
  const accessUntil = billing.googlePlaySubscriptionEnd ?? billing.premiumAccessUntil;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#fffaf0_0%,_#fff7fb_52%,_#fffdf3_100%)] text-[#5f2141]">
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-6 md:py-14">
        <section className="border-y border-pink-100 py-8 md:py-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Billing</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[#7a1f4f]">{billing.isPremium ? "Premium is active" : "Free plan"}</h1>
              <p className="mt-2 text-sm leading-6 text-pink-900/75">Premium includes unlimited image generation.</p>
            </div>
            <span className={billing.isPremium ? "rounded-full border border-pink-200 bg-pink-50 px-3 py-1.5 text-sm font-medium text-pink-700" : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600"}>
              {statusLabel}
            </span>
          </div>
          {accessUntil ? <p className="mt-5 text-sm text-pink-900/75">Access through {formatDate(accessUntil)}</p> : null}
          {billing.googlePlayActive ? <p className="mt-5 text-sm font-medium text-pink-900">Premium is active through Google Play.</p> : null}
          {billing.source === "both" ? <p className="mt-5 text-sm leading-6 text-amber-900">You appear to have active subscriptions through both Stripe and Google Play. You may want to cancel one to avoid duplicate billing.</p> : null}
          <div className="mt-7">
            <BillingActions isPremium={billing.isPremium} hasBillingProfile={Boolean(billing.stripeCustomerId)} />
          </div>
        </section>
      </div>
    </main>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}
