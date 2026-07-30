"use client";

import { useState } from "react";
import { toast } from "sonner";

type BillingActionsProps = {
  isPremium: boolean;
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

export default function BillingActions({ isPremium, hasBillingProfile }: BillingActionsProps) {
  const [loadingAction, setLoadingAction] = useState<"checkout" | "portal" | null>(null);

  async function startCheckout() {
    setLoadingAction("checkout");
    try {
      const response = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await safeJson(response);
      if (!response.ok || !data?.ok || typeof data?.url !== "string") {
        throw new Error(data?.error || "Unable to start premium checkout.");
      }
      window.location.assign(data.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start premium checkout.");
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
      {!isPremium ? (
        <button type="button" onClick={() => void startCheckout()} disabled={loadingAction !== null} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
          {loadingAction === "checkout" ? "Opening checkout..." : "Upgrade to premium"}
        </button>
      ) : null}

      {(isPremium || hasBillingProfile) ? (
        <button type="button" onClick={() => void openPortal()} disabled={loadingAction !== null} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60">
          {loadingAction === "portal" ? "Opening portal..." : "Manage billing"}
        </button>
      ) : null}
    </div>
  );
}