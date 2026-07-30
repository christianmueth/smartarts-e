import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import BillingActions from "@/components/BillingActions";
import { getBillingSnapshotForClerkUser } from "@/lib/billing";

export const dynamic = "force-dynamic";

const planCards = [
  {
    name: "Premium",
    tier: "premium",
    eyebrow: "For solo creators",
    description: "Unlock premium studio assists and keep a single creative account under active monthly billing.",
    features: [
      "AI-generated image placement in the whiteboard studio.",
      "Stripe-backed monthly billing and self-serve portal management.",
      "Existing personal studio, archive, and editor workflows under one paid plan.",
    ],
  },
  {
    name: "Organization",
    tier: "organization",
    eyebrow: "Higher tier",
    description: "Add collaborative controls and shared governance features on top of paid monthly billing.",
    features: [
      "Team workspaces",
      "Shared asset libraries",
      "Brand enforcement",
      "Approval workflows",
      "Organization controls",
    ],
  },
] as const;

export default async function BillingPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    redirect(`/?next=${encodeURIComponent("/app/billing")}`);
  }

  const billing = await getBillingSnapshotForClerkUser(clerkUserId);
  const statusLabel = billing.billingTier === "organization"
    ? "Organization active"
    : billing.billingTier === "premium"
      ? "Premium active"
      : billing.premiumStatus
        ? billing.premiumStatus.replace(/_/g, " ")
        : "Free plan";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,183,212,0.42),_transparent_28%),linear-gradient(180deg,_#fff6d6_0%,_#fff7fb_48%,_#fff0b8_100%)] text-[#5f2141]">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
        <section className="rounded-[2rem] border border-pink-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(255,243,198,0.88),rgba(255,239,248,0.88))] p-7 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Billing</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#7a1f4f]">Monthly plans for solo creators and organizations.</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-pink-900/80">
            Premium keeps the existing paid studio assists. Organization adds the higher-tier collaboration layer for teams that need shared assets, approvals, and brand control, with Stripe-backed monthly billing synchronized from webhooks.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-medium text-pink-700">
              {statusLabel}
            </span>
            <span className="rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm text-yellow-900">
              Current tier: {billing.billingTier === "free" ? "Free" : capitalize(billing.billingTier)}
            </span>
            {billing.premiumAccessUntil ? (
              <span className="rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm text-yellow-900">
                Access through {formatDate(billing.premiumAccessUntil)}
              </span>
            ) : null}
          </div>
          <div className="mt-6">
            <BillingActions currentTier={billing.billingTier} hasBillingProfile={Boolean(billing.stripeCustomerId)} />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {planCards.map((plan) => {
            const isCurrent = billing.billingTier === plan.tier;

            return (
              <article key={plan.tier} className="rounded-3xl border border-pink-100 bg-white/88 p-6 shadow-[0_12px_30px_rgba(255,213,115,0.14)]">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">{plan.eyebrow}</p>
                <div className="mt-3 flex items-center gap-3">
                  <h2 className="text-2xl font-semibold text-[#7a1f4f]">{plan.name}</h2>
                  {isCurrent ? (
                    <span className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-medium text-pink-700">Current plan</span>
                  ) : null}
                </div>
                <p className="mt-3 text-sm leading-7 text-pink-900/80">{plan.description}</p>
                <ul className="mt-4 space-y-2 text-sm leading-7 text-pink-900/80">
                  {plan.features.map((feature) => (
                    <li key={feature}>• {feature}</li>
                  ))}
                </ul>
              </article>
            );
          })}
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

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}