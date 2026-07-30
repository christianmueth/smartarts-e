"use client";

import { useEffect, useMemo, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import Image from "next/image";
import { toast } from "sonner";

type ProjectSummary = {
  id: string;
  name: string;
  brief: string | null;
  visualDirection: string | null;
  updatedAt: string;
  lastActivityAt: string;
  assetCount: number;
  messageCount: number;
};

type ProjectDetail = {
  id: string;
  name: string;
  brief: string | null;
  visualDirection: string | null;
  status: string;
  updatedAt: string;
  lastActivityAt: string;
  assetCount: number;
  messageCount: number;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    commandType: string | null;
    createdAt: string;
  }>;
  assets: Array<{
    id: string;
    kind: string;
    title: string;
    sourceUrl: string;
    prompt: string | null;
    enhancedPrompt: string | null;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    tags: string[];
    isSaved: boolean;
    mode: string | null;
    createdAt: string;
  }>;
};

type Props = {
  signedIn: boolean;
  initialProjects: ProjectSummary[];
  initialProject: ProjectDetail | null;
};

export default function HomeStudioMvp({ signedIn, initialProjects, initialProject }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [activeProject, setActiveProject] = useState(initialProject);
  const [activeProjectId, setActiveProjectId] = useState(initialProject?.id || initialProjects[0]?.id || null);
  const [prompt, setPrompt] = useState("");
  const [referenceImageDataUrl, setReferenceImageDataUrl] = useState<string | null>(null);
  const [referenceImageName, setReferenceImageName] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(initialProject?.assets[0]?.id || null);
  const [editorDraft, setEditorDraft] = useState("");
  const [busyAction, setBusyAction] = useState<"generate" | "edit" | "variation" | "reset" | "save-batch" | `save:${string}` | `delete:${string}` | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [currentBatchIds, setCurrentBatchIds] = useState<string[]>([]);
  const [hiddenAssetIds, setHiddenAssetIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedAssetId((current) => current && activeProject?.assets.some((asset) => asset.id === current)
      ? current
      : activeProject?.assets[0]?.id || null);
  }, [activeProject]);

  useEffect(() => {
    if (!signedIn || !activeProjectId || activeProject?.id === activeProjectId) return;
    setLoadingProject(true);
    void fetch(`/api/studio/projects/${activeProjectId}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || !data?.project) {
          throw new Error(data?.error || "Project loading failed.");
        }
        setActiveProject(data.project as ProjectDetail);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Project loading failed.");
      })
      .finally(() => setLoadingProject(false));
  }, [signedIn, activeProjectId, activeProject?.id]);

  const visibleAssets = useMemo(
    () => activeProject?.assets.filter((asset) => !hiddenAssetIds.includes(asset.id) && !asset.isSaved) ?? [],
    [activeProject, hiddenAssetIds]
  );
  const selectedAsset = visibleAssets.find((asset) => asset.id === selectedAssetId) ?? null;
  const results = useMemo(() => {
    if (!visibleAssets.length) return [] as ProjectDetail["assets"];
    const latestBatch = currentBatchIds
      .map((id) => visibleAssets.find((asset) => asset.id === id) || null)
      .filter((asset): asset is ProjectDetail["assets"][number] => Boolean(asset));
    return latestBatch.length ? latestBatch : visibleAssets.slice(0, 4);
  }, [visibleAssets, currentBatchIds]);
  const hasWorkspaceState = Boolean(visibleAssets.length || prompt.trim() || referenceImageDataUrl || editorDraft.trim() || activeProjectId);

  function getActionLabels(kind: "generate" | "edit" | "variation") {
    if (kind === "edit") {
      return {
        loading: "Applying your edit. This can take a little while.",
        success: "Edit complete.",
      };
    }
    if (kind === "variation") {
      return {
        loading: "Creating variations. This can take a little while.",
        success: "Variations ready.",
      };
    }
    return {
      loading: "Generating images. This can take a little while.",
      success: "Images ready.",
    };
  }

  function buildProjectSummary(project: ProjectDetail): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      brief: project.brief,
      visualDirection: project.visualDirection,
      updatedAt: project.updatedAt,
      lastActivityAt: project.lastActivityAt,
      assetCount: project.assetCount,
      messageCount: project.messageCount,
    };
  }

  function clearComposerState() {
    setPrompt("");
    setReferenceImageDataUrl(null);
    setReferenceImageName(null);
    setSelectedAssetId(null);
    setEditorDraft("");
    setCurrentBatchIds([]);
    setHiddenAssetIds([]);
    setActiveProject(null);
    setActiveProjectId(null);
  }

  async function ensureProject() {
    if (activeProjectId) return activeProjectId;
    const projectName = prompt.trim().split(/[.!?\n]/)[0].slice(0, 80) || "Untitled project";
    const response = await fetch("/api/studio/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName, brief: prompt.trim() || null }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !data?.project) {
      throw new Error(data?.error || "Project creation failed.");
    }
    const project = data.project as ProjectSummary;
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    return project.id;
  }

  async function runCommand(kind: "generate" | "edit" | "variation", content: string, assetId?: string | null, resultCount?: number) {
    const trimmedContent = content.trim();
    const hasReferenceInput = Boolean(referenceImageDataUrl || assetId);

    if (!trimmedContent && !(kind === "generate" && hasReferenceInput)) {
      toast.error(kind === "generate" ? "Add a prompt or attach a reference first." : "Add an edit instruction first.");
      return;
    }

    const actionLabels = getActionLabels(kind);
    const toastId = toast.loading(actionLabels.loading);
    setBusyAction(kind);
    try {
      const projectId = await ensureProject();
      const response = await fetch(`/api/studio/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmedContent,
          assetId: assetId || null,
          referenceImageDataUrl,
          resultCount: resultCount || (kind === "generate" || kind === "variation" ? 4 : 1),
          modeHint: kind === "edit" ? "edit" : "generate",
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        throw new Error(data?.error || "Image generation failed.");
      }

      const project = data.project as ProjectDetail;
      const batchIds = Array.isArray(data?.createdAssetIds) ? data.createdAssetIds.filter((value: unknown) => typeof value === "string") : [];
      setHiddenAssetIds([]);
      setActiveProject(project);
      setActiveProjectId(project.id);
      setProjects((current) => {
        const summary = buildProjectSummary(project);
        return [summary, ...current.filter((item) => item.id !== project.id)];
      });
      setCurrentBatchIds(batchIds);
      setSelectedAssetId(batchIds[0] || project.assets[0]?.id || null);
      if (kind === "generate") {
        setPrompt("");
        setReferenceImageDataUrl(null);
        setReferenceImageName(null);
      }
      if (kind === "edit") {
        setEditorDraft("");
      }
      toast.success(
        batchIds.length
          ? `${actionLabels.success} ${batchIds.length} ${batchIds.length === 1 ? "image" : "images"} added.`
          : actionLabels.success,
        { id: toastId }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image generation failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  function syncProject(project: ProjectDetail | null) {
    setActiveProject(project);
    setHiddenAssetIds((current) => current.filter((id) => project?.assets.some((asset) => asset.id === id)));
    if (!project) return;
    setActiveProjectId(project.id);
    setProjects((current) => {
      const summary = buildProjectSummary(project);
      return [summary, ...current.filter((item) => item.id !== project.id)];
    });
  }

  async function saveToLibrary(assetId: string, shouldSave: boolean, options?: { quiet?: boolean }) {
    const toastId = options?.quiet ? null : toast.loading(shouldSave ? "Saving to library..." : "Removing from library...");
    setBusyAction(`save:${assetId}`);
    try {
      const response = await fetch(`/api/studio/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saved: shouldSave }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        throw new Error(data?.error || "Library update failed.");
      }
      syncProject(data.project as ProjectDetail);
      if (!options?.quiet) {
        toast.success(shouldSave ? "Saved to library." : "Removed from library.", { id: toastId || undefined });
      }
    } catch (error) {
      if (!options?.quiet) {
        toast.error(error instanceof Error ? error.message : "Library update failed.", { id: toastId || undefined });
      }
      throw error;
    } finally {
      setBusyAction(null);
    }
  }

  async function saveBatchToLibrary(assetIds: string[]) {
    const uniqueAssetIds = Array.from(new Set(assetIds)).filter(Boolean);
    if (!uniqueAssetIds.length) {
      toast.error("No images to save.");
      return;
    }

    const unsavedAssetIds = uniqueAssetIds.filter((assetId) => {
      const asset = visibleAssets.find((item) => item.id === assetId);
      return asset && !asset.isSaved;
    });

    if (!unsavedAssetIds.length) {
      toast.message("These images are already in the library.");
      return;
    }

    const toastId = toast.loading(`Saving ${unsavedAssetIds.length} ${unsavedAssetIds.length === 1 ? "image" : "images"}...`);
    setBusyAction("save-batch");
    try {
      for (const assetId of unsavedAssetIds) {
        await saveToLibrary(assetId, true, { quiet: true });
      }
      toast.success(`${unsavedAssetIds.length} ${unsavedAssetIds.length === 1 ? "image" : "images"} saved to library.`, { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Library update failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteAsset(assetId: string) {
    const toastId = toast.loading("Deleting image...");
    setBusyAction(`delete:${assetId}`);
    const nextVisibleAssets = visibleAssets.filter((asset) => asset.id !== assetId);
    setHiddenAssetIds((current) => current.includes(assetId) ? current : [...current, assetId]);
    setCurrentBatchIds((current) => current.filter((id) => id !== assetId));
    setSelectedAssetId(nextVisibleAssets[0]?.id || null);
    setActiveProject((current) => current ? {
      ...current,
      assets: current.assets.filter((asset) => asset.id !== assetId),
      assetCount: Math.max(0, current.assetCount - 1),
    } : current);
    try {
      const response = await fetch(`/api/studio/assets/${assetId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Image deletion failed.");
      }
      const nextProject = (data?.project || null) as ProjectDetail | null;
      syncProject(nextProject);
      setSelectedAssetId(nextProject?.assets[0]?.id || null);
      toast.success("Image deleted.", { id: toastId });
    } catch (error) {
      setHiddenAssetIds((current) => current.filter((id) => id !== assetId));
      if (activeProjectId) {
        setLoadingProject(true);
        void fetch(`/api/studio/projects/${activeProjectId}`, { cache: "no-store" })
          .then(async (reloadResponse) => {
            const reloadData = await reloadResponse.json().catch(() => null);
            if (!reloadResponse.ok || !reloadData?.ok || !reloadData?.project) {
              throw new Error(reloadData?.error || "Project loading failed.");
            }
            const project = reloadData.project as ProjectDetail;
            syncProject(project);
            setSelectedAssetId(project.assets[0]?.id || null);
          })
          .catch(() => {
            // Keep the original toast error below as the user-facing signal.
          })
          .finally(() => setLoadingProject(false));
      }
      toast.error(error instanceof Error ? error.message : "Image deletion failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  async function startNewSession() {
    if (!activeProjectId) {
      clearComposerState();
      return;
    }

    const currentProjectId = activeProjectId;
    const toastId = toast.loading("Starting a fresh session...");
    setBusyAction("reset");
    try {
      const response = await fetch(`/api/studio/projects/${currentProjectId}/reset`, {
        method: "POST",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        throw new Error(data?.error || "New session failed.");
      }
      const project = data.project as ProjectDetail;
      setProjects((current) => [buildProjectSummary(project), ...current.filter((item) => item.id !== project.id)]);
      clearComposerState();
      toast.success(data.deletedAssetCount ? `Fresh session ready. ${data.deletedAssetCount} unsaved ${data.deletedAssetCount === 1 ? "image" : "images"} cleared.` : "Fresh session ready.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "New session failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReferenceUpload(file: File | null) {
    if (!file) {
      setReferenceImageDataUrl(null);
      setReferenceImageName(null);
      return;
    }
    try {
      const nextValue = await readReferenceImageDataUrl(file);
      setReferenceImageDataUrl(nextValue);
      setReferenceImageName(file.name);
    } catch (error) {
      setReferenceImageDataUrl(null);
      setReferenceImageName(null);
      toast.error(error instanceof Error ? error.message : "Reference image could not be processed.");
    }
  }

  function downloadImage(asset: ProjectDetail["assets"][number]) {
    const anchor = document.createElement("a");
    anchor.href = asset.sourceUrl;
    anchor.download = `${slugify(asset.title)}.png`;
    anchor.click();
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,183,212,0.42),_transparent_28%),linear-gradient(180deg,_#fff6d6_0%,_#fff7fb_48%,_#fff0b8_100%)] text-[#5f2141]">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
        <section className="rounded-[2rem] border border-pink-200/80 bg-white/78 p-5 shadow-[0_18px_60px_rgba(255,129,181,0.18)] backdrop-blur md:p-6">
          <div className="space-y-3">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-3">
                <div className="inline-flex w-fit rounded-full border border-yellow-200 bg-yellow-100/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-pink-700">
                  Studio
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-[#7a1f4f] md:text-4xl">Create</h1>
              </div>
              <div className="flex items-center justify-center md:justify-end">
                <div className="rounded-[2rem] border border-pink-200 bg-[linear-gradient(180deg,_rgba(255,246,251,0.98),_rgba(255,248,216,0.95))] p-3 shadow-[0_18px_44px_rgba(255,170,205,0.28)]">
                  <Image
                    src="/smartarts-e_logo.png"
                    alt="SmartArts-E"
                    width={224}
                    height={224}
                    priority
                    className="h-28 w-28 rounded-[1.5rem] object-cover md:h-36 md:w-36"
                  />
                </div>
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the image you want"
              className="min-h-[164px] w-full resize-none rounded-[1.75rem] border border-pink-200 bg-[linear-gradient(180deg,_rgba(255,244,250,0.98),_rgba(255,250,214,0.95))] px-5 py-4 text-base text-[#6d2141] outline-none placeholder:text-pink-300 shadow-inner shadow-pink-100/60"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-medium text-pink-700 transition hover:bg-pink-100">
                Reference
                <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleReferenceUpload(event.target.files?.[0] || null)} />
              </label>
              {referenceImageName ? (
                <button type="button" onClick={() => void handleReferenceUpload(null)} className="rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-800 transition hover:bg-yellow-100">
                  Clear
                </button>
              ) : null}
              {signedIn ? (
                <button
                  type="button"
                  onClick={() => void runCommand("generate", prompt, null, 4)}
                  disabled={busyAction !== null || loadingProject}
                  className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(255,95,178,0.35)] transition hover:scale-[1.01] disabled:opacity-60"
                >
                  {busyAction === "generate" ? "Generating..." : "Generate"}
                </button>
              ) : (
                <SignInButton mode="modal" forceRedirectUrl="/" signUpForceRedirectUrl="/">
                  <button className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(255,95,178,0.35)] transition hover:scale-[1.01]">
                    Generate
                  </button>
                </SignInButton>
              )}
              <button
                type="button"
                onClick={() => void startNewSession()}
                disabled={busyAction !== null || !hasWorkspaceState}
                className="rounded-full border border-pink-200 bg-white/85 px-4 py-2 text-sm font-medium text-pink-700 transition hover:bg-pink-50 disabled:opacity-60"
              >
                {busyAction === "reset" ? "Clearing..." : "New session"}
              </button>
            </div>
            {referenceImageDataUrl ? (
              <img src={referenceImageDataUrl} alt={referenceImageName || "Reference image"} className="h-28 w-28 rounded-[1.25rem] border border-pink-200 object-cover shadow-[0_10px_30px_rgba(255,170,205,0.28)]" />
            ) : null}
          </div>
        </section>

        <section className="rounded-[2rem] border border-yellow-200/80 bg-white/82 p-4 shadow-[0_18px_60px_rgba(255,208,64,0.18)] backdrop-blur md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-[#7a1f4f]">Results</h2>
              {results.length ? <p className="mt-1 text-sm text-pink-600">Keep what you want, then clear the board for the next round.</p> : null}
            </div>
            <div className="flex items-center gap-2">
              {results.length ? (
                <button
                  type="button"
                  onClick={() => void startNewSession()}
                  disabled={busyAction !== null}
                  className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1.5 text-sm font-medium text-pink-700 transition hover:bg-pink-100 disabled:opacity-60"
                >
                  {busyAction === "reset" ? "Clearing..." : "Clear session"}
                </button>
              ) : null}
              {results.length ? (
                <button
                  type="button"
                  onClick={() => void saveBatchToLibrary(results.map((asset) => asset.id))}
                  disabled={busyAction !== null}
                  className="rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm font-medium text-yellow-900 transition hover:bg-yellow-100 disabled:opacity-60"
                >
                  {busyAction === "save-batch" ? "Saving..." : "Save all"}
                </button>
              ) : null}
              {loadingProject ? <span className="text-sm text-pink-500">Loading...</span> : null}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {results.length ? results.map((asset) => (
              <article
                key={asset.id}
                className={asset.id === selectedAssetId
                  ? "overflow-hidden rounded-[1.75rem] border border-pink-400 bg-white/95 shadow-[0_16px_40px_rgba(255,124,185,0.22)]"
                  : "overflow-hidden rounded-[1.75rem] border border-pink-100 bg-white/90 shadow-[0_10px_24px_rgba(255,213,115,0.16)]"
                }
              >
                <button
                  type="button"
                  onClick={() => setSelectedAssetId(asset.id)}
                  className="block w-full text-left"
                >
                  <img src={asset.sourceUrl} alt={asset.title} className="h-64 w-full object-cover" />
                </button>
                <div className="flex items-center justify-between gap-2 px-3 py-3">
                  <button
                    type="button"
                    onClick={() => setSelectedAssetId(asset.id)}
                    className="text-sm font-medium text-pink-700 hover:text-pink-900"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveToLibrary(asset.id, !asset.isSaved)}
                    disabled={busyAction === `save:${asset.id}`}
                    className={asset.isSaved
                      ? "rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                      : "rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm font-medium text-yellow-900 hover:bg-yellow-100 disabled:opacity-60"
                    }
                  >
                    {busyAction === `save:${asset.id}` ? "Saving..." : asset.isSaved ? "Saved" : "Save"}
                  </button>
                </div>
              </article>
            )) : (
              <div className="md:col-span-2 xl:col-span-4 rounded-[1.75rem] border border-dashed border-pink-200 bg-[linear-gradient(180deg,_rgba(255,241,247,0.95),_rgba(255,249,212,0.9))] px-6 py-12 text-center text-sm text-pink-500">
                Generate to see results.
              </div>
            )}
          </div>
        </section>

        {selectedAsset ? (
          <section className="rounded-[2rem] border border-pink-200/80 bg-white/82 p-5 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur md:p-6">
            <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
              <div className="space-y-3">
                <img src={selectedAsset.sourceUrl} alt={selectedAsset.title} className="h-56 w-full rounded-[1.75rem] border border-pink-200 object-cover shadow-[0_14px_32px_rgba(255,177,209,0.28)]" />
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveToLibrary(selectedAsset.id, !selectedAsset.isSaved)}
                      disabled={busyAction === `save:${selectedAsset.id}`}
                      className={selectedAsset.isSaved
                        ? "rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        : "rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-900 hover:bg-yellow-100 disabled:opacity-60"
                      }
                    >
                      {busyAction === `save:${selectedAsset.id}` ? "Saving..." : selectedAsset.isSaved ? "Saved to library" : "Save to library"}
                    </button>
                    <button type="button" onClick={() => downloadImage(selectedAsset)} className="rounded-full border border-pink-200 bg-white px-4 py-2 text-sm font-medium text-pink-700 hover:bg-pink-50">
                      Download
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void startNewSession()}
                      disabled={busyAction !== null}
                      className="rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-medium text-pink-700 hover:bg-pink-100 disabled:opacity-60"
                    >
                      {busyAction === "reset" ? "Clearing..." : "New session"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runCommand("variation", "Create four variations of this image. Keep the core subject and composition while exploring new treatments.", selectedAsset.id, 4)}
                      disabled={busyAction !== null}
                      className="rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-900 hover:bg-yellow-100 disabled:opacity-60"
                    >
                      {busyAction === "variation" ? "Varying..." : "Create variations"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteAsset(selectedAsset.id)}
                      disabled={busyAction === `delete:${selectedAsset.id}`}
                      className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                    >
                      {busyAction === `delete:${selectedAsset.id}` ? "Deleting..." : "Delete image"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <h2 className="text-lg font-medium text-[#7a1f4f]">Edit</h2>
                <textarea
                  value={editorDraft}
                  onChange={(event) => setEditorDraft(event.target.value)}
                  placeholder="Describe one change"
                  className="min-h-[140px] w-full rounded-[1.75rem] border border-pink-200 bg-[linear-gradient(180deg,_rgba(255,244,250,0.98),_rgba(255,250,214,0.95))] px-4 py-3 text-sm text-[#6d2141] outline-none placeholder:text-pink-300 shadow-inner shadow-pink-100/60"
                />
                <button
                  type="button"
                  onClick={() => void runCommand("edit", editorDraft, selectedAssetId, 1)}
                  disabled={!selectedAssetId || busyAction !== null}
                  className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(255,95,178,0.28)] transition hover:scale-[1.01] disabled:opacity-60"
                >
                  {busyAction === "edit" ? "Applying..." : "Apply edit"}
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "smartarts-image";
}

async function readReferenceImageDataUrl(file: File) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(originalDataUrl);
  const maxDimension = 1024;
  const scale = Math.min(1, maxDimension / Math.max(image.width || 1, image.height || 1));

  if (scale >= 1 && file.size <= 900_000) {
    return originalDataUrl;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    return originalDataUrl;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function readFileAsDataUrl(file: File) {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Reference image could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Reference image could not be processed."));
    image.src = src;
  });
}