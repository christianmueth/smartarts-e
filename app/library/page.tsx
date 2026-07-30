import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
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

        {assets.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {assets.map((asset) => (
              <article key={asset.id} className="overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-sm">
                <img src={asset.sourceUrl} alt={asset.title} className="h-64 w-full object-cover" />
                <div className="space-y-2 p-4">
                  <div>
                    <h2 className="text-sm font-medium text-stone-950">{asset.title}</h2>
                    <p className="mt-1 text-xs text-stone-500">{asset.projectName}</p>
                  </div>
                  <p className="text-xs leading-5 text-stone-600">{truncate(asset.enhancedPrompt || asset.prompt || "Saved image", 100)}</p>
                  <a href={asset.sourceUrl} download={`${slugify(asset.title)}.png`} className="inline-flex rounded-full border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">
                    Download
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-white px-6 py-14 text-center text-sm text-stone-500">
            Save images from the homepage to build your library.
          </div>
        )}
      </div>
    </main>
  );
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "smartarts-image";
}