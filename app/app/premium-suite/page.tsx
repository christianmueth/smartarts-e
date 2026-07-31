import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OrganizationWorkspace from "@/components/OrganizationWorkspace";
import { getBillingSnapshotForClerkUser } from "@/lib/billing";
import { listOrganizationSharedAssetsForClerkUser, listOrganizationWorkspacesForClerkUser } from "@/lib/organization";
import { listSavedStudioAssetsForClerkUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

export default async function PremiumSuitePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/?next=%2Fapp%2Fpremium-suite");
  }

  const billing = await getBillingSnapshotForClerkUser(userId);
  if (!billing.isPremium) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,183,212,0.42),_transparent_28%),linear-gradient(180deg,_#fff6d6_0%,_#fff7fb_48%,_#fff0b8_100%)] text-[#5f2141]">
        <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
          <section className="rounded-[2rem] border border-pink-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(255,243,198,0.88),rgba(255,239,248,0.88))] p-8 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Premium Suite</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#7a1f4f]">Upgrade to Premium to unlock Premium Suite collaboration.</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-pink-900/80">
              Free includes 10 image generations per UTC calendar month. Premium includes unlimited image generation, plus team workspaces, shared asset libraries, brand enforcement, approval workflows, and Premium Suite controls.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/app/billing" className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(255,95,178,0.28)]">Open billing</a>
              <a href="/library" className="rounded-full border border-pink-200 bg-white/85 px-5 py-2.5 text-sm font-medium text-pink-700 hover:bg-pink-50">Back to library</a>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const [workspaces, sharedAssets, personalAssets] = await Promise.all([
    listOrganizationWorkspacesForClerkUser(userId),
    listOrganizationSharedAssetsForClerkUser(userId),
    listSavedStudioAssetsForClerkUser(userId),
  ]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,183,212,0.42),_transparent_28%),linear-gradient(180deg,_#fff6d6_0%,_#fff7fb_48%,_#fff0b8_100%)] text-[#5f2141]">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="inline-flex rounded-full border border-yellow-300 bg-yellow-100/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-pink-700">
              Premium Suite
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#7a1f4f]">Team workspaces and shared premium governance.</h1>
            <p className="mt-2 text-sm text-pink-900/80">Unlimited image generation is included with your Premium plan.</p>
          </div>
          <a href="/app/billing" className="rounded-full border border-pink-200 bg-white/85 px-4 py-2 text-sm font-medium text-pink-700 hover:bg-pink-50">Billing</a>
        </div>

        <OrganizationWorkspace
          initialWorkspaces={workspaces}
          initialSharedAssets={sharedAssets}
          initialPersonalAssets={personalAssets.map((asset) => ({
            id: asset.id,
            title: asset.title,
            sourceUrl: asset.sourceUrl,
            projectName: asset.projectName,
            createdAt: asset.createdAt,
          }))}
        />
      </div>
    </main>
  );
}