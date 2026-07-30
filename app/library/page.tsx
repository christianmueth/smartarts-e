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
    <main className="min-h-screen bg-stone-50 text-stone-950">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
            <p className="mt-1 text-sm text-stone-600">Saved images only.</p>
          </div>
          <a href="/" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">Back</a>
        </div>

        <LibraryWorkspace initialAssets={assets} />
      </div>
    </main>
  );
}
