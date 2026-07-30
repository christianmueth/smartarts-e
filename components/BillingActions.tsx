"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { BillingTier } from "@/lib/billing";

type BillingActionsProps = {
  currentTier: BillingTier;
  hasBillingProfile: boolean;
};

async function safeJson(response: Response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default function BillingActions({ currentTier, hasBillingProfile }: BillingActionsProps) {
  const [loadingAction, setLoadingAction] = useState<"checkout" | "portal" | null>(null);
  const hasPaidPlan = currentTier !== "free";

  async function startCheckout(tier: "premium" | "organization") {
    setLoadingAction("checkout");
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await safeJson(response);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Unable to start ${tier} checkout.`);
      }
      if (data?.updated) {
        toast.success(`Your plan is switching to ${tier}.`);
        window.location.assign("/app/billing?plan=updated");
        return;
      }
      if (typeof data?.url !== "string") {
        throw new Error(`Unable to start ${tier} checkout.`);
      }
      window.location.assign(data.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to start ${tier} checkout.`);
      setLoadingAction(null);
    }
  }

  async function openPortal() {
    setLoadingAction("portal");
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await safeJson(response);
      if (!response.ok || !data?.ok || typeof data?.url !== "string") {
        throw new Error(data?.error || "Unable to open the billing portal.");
      }
      window.location.assign(data.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open the billing portal.");
      setLoadingAction(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      {!hasPaidPlan ? (
        <button type="button" onClick={() => void startCheckout("premium")} disabled={loadingAction !== null} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
          {loadingAction === "checkout" ? "Opening checkout..." : "Upgrade to Premium"}
        </button>
      ) : null}

      {currentTier === "premium" ? (
        <button type="button" onClick={() => void startCheckout("organization")} disabled={loadingAction !== null} className="rounded-full border border-pink-300 bg-pink-50 px-4 py-2 text-sm font-medium text-pink-800 hover:bg-pink-100 disabled:opacity-60">
          {loadingAction === "checkout" ? "Updating plan..." : "Move to Organization"}
        </button>
      ) : null}

      {(hasPaidPlan || hasBillingProfile) ? (
        <button type="button" onClick={() => void openPortal()} disabled={loadingAction !== null} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60">
          {loadingAction === "portal" ? "Opening portal..." : "Manage billing"}
        </button>
      ) : null}

      {!hasPaidPlan ? (
        <button type="button" onClick={() => void startCheckout("organization")} disabled={loadingAction !== null} className="rounded-full border border-pink-300 bg-pink-50 px-4 py-2 text-sm font-medium text-pink-800 hover:bg-pink-100 disabled:opacity-60">
          {loadingAction === "checkout" ? "Opening checkout..." : "Upgrade to Organization"}
        </button>
      ) : null}
    </div>
  );
}