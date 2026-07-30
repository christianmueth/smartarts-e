"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

type LibraryAsset = {
  id: string;
  title: string;
  sourceUrl: string;
  prompt: string | null;
  enhancedPrompt: string | null;
  projectId: string;
  projectName: string;
  createdAt: string;
};

type Props = {
  initialAssets: LibraryAsset[];
};

export default function LibraryWorkspace({ initialAssets }: Props) {
  const [assets, setAssets] = useState(initialAssets);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(initialAssets[0]?.id || null);
  const [editPrompt, setEditPrompt] = useState("");
  const [busyAction, setBusyAction] = useState<"edit" | `delete:${string}` | null>(null);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId]
  );

  async function deleteAsset(assetId: string) {
    const toastId = toast.loading("Deleting image...");
    setBusyAction(`delete:${assetId}`);
    const remainingAssets = assets.filter((asset) => asset.id !== assetId);
    setAssets(remainingAssets);
    setSelectedAssetId((current) => current === assetId ? (remainingAssets[0]?.id || null) : current);

    try {
      const response = await fetch(`/api/studio/assets/${assetId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Image deletion failed.");
      }
      toast.success("Image deleted.", { id: toastId });
    } catch (error) {
      setAssets(initialAssets);
      setSelectedAssetId(assetId);
      toast.error(error instanceof Error ? error.message : "Image deletion failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  async function editAsset() {
    if (!selectedAsset || !editPrompt.trim()) {
      toast.error("Add an edit instruction first.");
      return;
    }

    const toastId = toast.loading("Applying edit. This can take a little while.");
    setBusyAction("edit");
    try {
      const response = await fetch(`/api/studio/projects/${selectedAsset.projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editPrompt,
          assetId: selectedAsset.id,
          resultCount: 1,
          modeHint: "edit",
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project || !Array.isArray(data?.createdAssetIds) || !data.createdAssetIds[0]) {
        throw new Error(data?.error || "Image edit failed.");
      }

      const createdAssetId = data.createdAssetIds[0] as string;
      const saveResponse = await fetch(`/api/studio/assets/${createdAssetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: true }),
      });
      const saveData = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok || !saveData?.ok || !saveData?.project) {
        throw new Error(saveData?.error || "Edited image could not be saved to the library.");
      }

      const project = saveData.project as {
        assets: Array<{
          id: string;
          title: string;
          sourceUrl: string;
          prompt: string | null;
          enhancedPrompt: string | null;
          isFavorite: boolean;
          createdAt: string;
        }>;
      };
      const createdAsset = project.assets.find((asset) => asset.id === createdAssetId);
      if (!createdAsset) {
        throw new Error("Edited image was created but could not be loaded.");
      }

      const nextAsset: LibraryAsset = {
        id: createdAsset.id,
        title: createdAsset.title,
        sourceUrl: createdAsset.sourceUrl,
        prompt: createdAsset.prompt,
        enhancedPrompt: createdAsset.enhancedPrompt,
        projectId: selectedAsset.projectId,
        projectName: selectedAsset.projectName,
        createdAt: createdAsset.createdAt,
      };

      setAssets((current) => [nextAsset, ...current.filter((asset) => asset.id !== nextAsset.id)]);
      setSelectedAssetId(nextAsset.id);
      setEditPrompt("");
      toast.success("Edited image added to library.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image edit failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        {assets.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => (
              <article key={asset.id} className={asset.id === selectedAssetId
                ? "overflow-hidden rounded-[1.5rem] border border-stone-950 bg-white shadow-sm"
                : "overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-sm"
              }>
                <button type="button" onClick={() => setSelectedAssetId(asset.id)} className="block w-full text-left">
                  <img src={asset.sourceUrl} alt={asset.title} className="h-64 w-full object-cover" />
                </button>
                <div className="space-y-2 p-4">
                  <div>
                    <h2 className="text-sm font-medium text-stone-950">{formatLibraryLabel(asset.createdAt)}</h2>
                    <p className="mt-1 text-xs text-stone-500">{asset.projectName}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedAssetId(asset.id)} className="inline-flex rounded-full border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">
                    Open
                  </button>
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

      <aside className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
        {selectedAsset ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-medium text-stone-950">{formatLibraryLabel(selectedAsset.createdAt)}</h2>
              <p className="mt-1 text-sm text-stone-500">{selectedAsset.projectName}</p>
            </div>
            <img src={selectedAsset.sourceUrl} alt={selectedAsset.title} className="h-72 w-full rounded-[1.5rem] border border-stone-200 object-cover" />
            <div className="flex flex-wrap gap-2">
              <a href={selectedAsset.sourceUrl} download={`${slugify(selectedAsset.title)}.png`} className="rounded-full border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">
                Download
              </a>
              <button
                type="button"
                onClick={() => void deleteAsset(selectedAsset.id)}
                disabled={busyAction === `delete:${selectedAsset.id}`}
                className="rounded-full border border-red-200 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {busyAction === `delete:${selectedAsset.id}` ? "Deleting..." : "Delete image"}
              </button>
            </div>
            <div className="space-y-3 border-t border-stone-200 pt-4">
              <h3 className="text-sm font-medium text-stone-950">Edit image</h3>
              <textarea
                value={editPrompt}
                onChange={(event) => setEditPrompt(event.target.value)}
                placeholder="Describe one change"
                className="min-h-[132px] w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none placeholder:text-stone-400"
              />
              <button
                type="button"
                onClick={() => void editAsset()}
                disabled={busyAction !== null}
                className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
              >
                {busyAction === "edit" ? "Applying..." : "Apply edit"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[1.25rem] border border-dashed border-stone-300 bg-stone-50 px-6 text-center text-sm text-stone-500">
            Open a saved image to edit or delete it.
          </div>
        )}
      </aside>
    </div>
  );
}

function formatLibraryLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved image";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "smartarts-image";
}