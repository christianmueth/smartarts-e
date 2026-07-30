import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import LibraryWorkspace from "@/components/LibraryWorkspace";
import { listSavedStudioAssetsForClerkUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/?next=%2Flibrary");
  }

  const assets = await listSavedStudioAssetsForClerkUser(userId);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,183,212,0.42),_transparent_28%),linear-gradient(180deg,_#fff6d6_0%,_#fff7fb_48%,_#fff0b8_100%)] text-[#5f2141]">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="inline-flex rounded-full border border-yellow-300 bg-yellow-100/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-pink-700">
              Lemonade Archive
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#7a1f4f]">Library</h1>
            <p className="mt-1 text-sm text-pink-600">Saved images only.</p>
          </div>
          <a href="/" className="rounded-full border border-pink-200 bg-white/85 px-4 py-2 text-sm font-medium text-pink-700 hover:bg-pink-50">Back</a>
        </div>

        <LibraryWorkspace initialAssets={assets} />
      </div>
    </main>
  );
}
