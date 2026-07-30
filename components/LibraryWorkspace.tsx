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
  const [busyAction, setBusyAction] = useState<"edit" | "upload" | `delete:${string}` | null>(null);

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
        body: JSON.stringify({ saved: true }),
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
          isSaved: boolean;
          createdAt: string;
        }>;
      };
      const createdAsset = project.assets.find((asset) => asset.id === createdAssetId);
      if (!createdAsset) {
        throw new Error("Edited image was created but could not be loaded.");
      }

      const nextAsset: LibraryAsset = {
        id: createdAsset.id,
        title: buildLibraryAssetTitle(createdAsset.createdAt),
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

  async function uploadImage(file: File | null) {
    if (!file) return;

    const toastId = toast.loading("Uploading image...");
    setBusyAction("upload");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("saved", "true");
      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.asset) {
        throw new Error(data?.error || "Image upload failed.");
      }

      const asset = data.asset as {
        id: string;
        title: string;
        imageUrl: string;
        prompt: string | null;
        sourceAssetId: string | null;
        createdAt: string;
      };
      const nextAsset: LibraryAsset = {
        id: asset.id,
        title: buildLibraryAssetTitle(asset.createdAt),
        sourceUrl: asset.imageUrl,
        prompt: asset.prompt,
        enhancedPrompt: asset.prompt,
        projectId: "",
        projectName: "Easy Easel",
        createdAt: asset.createdAt,
      };

      setAssets((current) => [nextAsset, ...current.filter((item) => item.id !== nextAsset.id)]);
      setSelectedAssetId(nextAsset.id);
      toast.success("Image added to archive.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-pink-600">Saved images only.</p>
          <label className="inline-flex cursor-pointer rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-medium text-pink-700 hover:bg-pink-100">
            {busyAction === "upload" ? "Uploading..." : "Upload image"}
            <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadImage(event.target.files?.[0] || null)} />
          </label>
        </div>
        {assets.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => (
              <article key={asset.id} className={asset.id === selectedAssetId
                ? "overflow-hidden rounded-[1.75rem] border border-pink-400 bg-white/95 shadow-[0_16px_40px_rgba(255,124,185,0.22)]"
                : "overflow-hidden rounded-[1.75rem] border border-pink-100 bg-white/92 shadow-[0_10px_24px_rgba(255,213,115,0.16)]"
              }>
                <button type="button" onClick={() => setSelectedAssetId(asset.id)} className="block w-full text-left">
                  <img src={asset.sourceUrl} alt={asset.title} className="h-64 w-full object-cover" />
                </button>
                <div className="space-y-2 p-4">
                  <div>
                    <h2 className="text-sm font-medium text-[#7a1f4f]">{formatLibraryLabel(asset.createdAt)}</h2>
                    <p className="mt-1 text-xs text-pink-500">{asset.projectName}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedAssetId(asset.id)} className="inline-flex rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm font-medium text-yellow-900 hover:bg-yellow-100">
                    Open
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-pink-200 bg-[linear-gradient(180deg,_rgba(255,241,247,0.95),_rgba(255,249,212,0.9))] px-6 py-14 text-center text-sm text-pink-500">
            Upload images or save them from the homepage to build your archive.
          </div>
        )}
      </div>

      <aside className="rounded-[1.75rem] border border-pink-200/80 bg-white/84 p-5 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
        {selectedAsset ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-medium text-[#7a1f4f]">{formatLibraryLabel(selectedAsset.createdAt)}</h2>
              <p className="mt-1 text-sm text-pink-500">{selectedAsset.projectName}</p>
            </div>
            <img src={selectedAsset.sourceUrl} alt={selectedAsset.title} className="h-72 w-full rounded-[1.75rem] border border-pink-200 object-cover shadow-[0_14px_32px_rgba(255,177,209,0.28)]" />
            <div className="flex flex-wrap gap-2">
              <a href={selectedAsset.sourceUrl} download={`${slugify(selectedAsset.title)}.png`} className="rounded-full border border-pink-200 bg-white px-4 py-2 text-sm font-medium text-pink-700 hover:bg-pink-50">
                Download
              </a>
              <button
                type="button"
                onClick={() => void deleteAsset(selectedAsset.id)}
                disabled={busyAction === `delete:${selectedAsset.id}`}
                className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {busyAction === `delete:${selectedAsset.id}` ? "Deleting..." : "Delete image"}
              </button>
            </div>
            <div className="space-y-3 border-t border-pink-100 pt-4">
              <h3 className="text-sm font-medium text-[#7a1f4f]">Edit image</h3>
              <textarea
                value={editPrompt}
                onChange={(event) => setEditPrompt(event.target.value)}
                placeholder="Describe one change"
                className="min-h-[132px] w-full rounded-[1.5rem] border border-pink-200 bg-[linear-gradient(180deg,_rgba(255,244,250,0.98),_rgba(255,250,214,0.95))] px-4 py-3 text-sm text-[#6d2141] outline-none placeholder:text-pink-300 shadow-inner shadow-pink-100/60"
              />
              <button
                type="button"
                onClick={() => void editAsset()}
                disabled={busyAction !== null}
                className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(255,95,178,0.28)] transition hover:scale-[1.01] disabled:opacity-60"
              >
                {busyAction === "edit" ? "Applying..." : "Apply edit"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[1.5rem] border border-dashed border-pink-200 bg-[linear-gradient(180deg,_rgba(255,241,247,0.95),_rgba(255,249,212,0.9))] px-6 text-center text-sm text-pink-500">
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

function buildLibraryAssetTitle(value: string) {
  return `Saved image ${formatLibraryLabel(value)}`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "smartarts-image";
}