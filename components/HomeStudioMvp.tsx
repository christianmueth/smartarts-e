"use client";

import { useEffect, useMemo, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
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
    isFavorite: boolean;
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
  const [busyAction, setBusyAction] = useState<"generate" | "edit" | "variation" | `favorite:${string}` | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [currentBatchIds, setCurrentBatchIds] = useState<string[]>([]);

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

  const selectedAsset = activeProject?.assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const results = useMemo(() => {
    if (!activeProject?.assets.length) return [] as ProjectDetail["assets"];
    const latestBatch = currentBatchIds
      .map((id) => activeProject.assets.find((asset) => asset.id === id) || null)
      .filter((asset): asset is ProjectDetail["assets"][number] => Boolean(asset));
    return latestBatch.length ? latestBatch : activeProject.assets.slice(0, 4);
  }, [activeProject, currentBatchIds]);

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
    if (!signedIn) {
      toast.message("Sign in to generate, edit, and save project history.");
      return;
    }
    if (!content.trim()) {
      toast.error(kind === "generate" ? "Add a prompt first." : "Add an edit instruction first.");
      return;
    }

    setBusyAction(kind);
    try {
      const projectId = await ensureProject();
      const response = await fetch(`/api/studio/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          assetId: assetId || null,
          referenceImageDataUrl,
          resultCount: resultCount || (kind === "generate" || kind === "variation" ? 4 : 1),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        throw new Error(data?.error || "Image generation failed.");
      }

      const project = data.project as ProjectDetail;
      const batchIds = Array.isArray(data?.createdAssetIds) ? data.createdAssetIds.filter((value: unknown) => typeof value === "string") : [];
      setActiveProject(project);
      setActiveProjectId(project.id);
      setProjects((current) => {
        const summary: ProjectSummary = {
          id: project.id,
          name: project.name,
          brief: project.brief,
          visualDirection: project.visualDirection,
          updatedAt: project.updatedAt,
          lastActivityAt: project.lastActivityAt,
          assetCount: project.assetCount,
          messageCount: project.messageCount,
        };
        return [summary, ...current.filter((item) => item.id !== project.id)];
      });
      setCurrentBatchIds(batchIds);
      setSelectedAssetId(batchIds[0] || project.assets[0]?.id || null);
      if (kind === "generate") {
        setPrompt("");
      }
      if (kind === "edit") {
        setEditorDraft("");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image generation failed.");
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
    const reader = new FileReader();
    const nextValue = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Reference image could not be read."));
      reader.readAsDataURL(file);
    });
    setReferenceImageDataUrl(nextValue);
    setReferenceImageName(file.name);
  }

  function downloadImage(asset: ProjectDetail["assets"][number]) {
    const anchor = document.createElement("a");
    anchor.href = asset.sourceUrl;
    anchor.download = `${slugify(asset.title)}.png`;
    anchor.click();
  }

  return (
    <main className="min-h-screen bg-stone-50 text-stone-950">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
        <section className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm md:p-6">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl">Create</h1>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the image you want"
              className="min-h-[164px] w-full resize-none rounded-[1.5rem] border border-stone-200 bg-stone-50 px-5 py-4 text-base text-stone-950 outline-none placeholder:text-stone-400"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-full border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">
                Reference
                <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleReferenceUpload(event.target.files?.[0] || null)} />
              </label>
              {referenceImageName ? (
                <button type="button" onClick={() => void handleReferenceUpload(null)} className="rounded-full border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">
                  Clear
                </button>
              ) : null}
              {!signedIn ? (
                <SignInButton mode="modal" forceRedirectUrl="/" signUpForceRedirectUrl="/">
                  <button className="rounded-full border border-stone-900 px-4 py-2 text-sm text-stone-950 hover:bg-stone-100">Sign in</button>
                </SignInButton>
              ) : null}
              <button
                type="button"
                onClick={() => void runCommand("generate", prompt, null, 4)}
                disabled={busyAction !== null || loadingProject}
                className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
              >
                {busyAction === "generate" ? "Generating..." : "Generate"}
              </button>
            </div>
            {referenceImageDataUrl ? (
              <img src={referenceImageDataUrl} alt={referenceImageName || "Reference image"} className="h-28 w-28 rounded-2xl border border-stone-200 object-cover" />
            ) : null}
          </div>
        </section>

        <section className="rounded-[2rem] border border-stone-200 bg-white p-4 shadow-sm md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium text-stone-950">Results</h2>
            {loadingProject ? <span className="text-sm text-stone-500">Loading...</span> : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {results.length ? results.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setSelectedAssetId(asset.id)}
                className={asset.id === selectedAssetId
                  ? "overflow-hidden rounded-[1.5rem] border border-stone-950 bg-white text-left"
                  : "overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white text-left"
                }
              >
                <img src={asset.sourceUrl} alt={asset.title} className="h-64 w-full object-cover" />
              </button>
            )) : (
              <div className="md:col-span-2 xl:col-span-4 rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center text-sm text-stone-500">
                Generate to see results.
              </div>
            )}
          </div>
        </section>

        {selectedAsset ? (
          <section className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm md:p-6">
            <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
              <div className="space-y-3">
                <img src={selectedAsset.sourceUrl} alt={selectedAsset.title} className="h-56 w-full rounded-[1.5rem] border border-stone-200 object-cover" />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runCommand("variation", "Create four variations of this image. Keep the core subject and composition while exploring new treatments.", selectedAsset.id, 4)}
                    disabled={busyAction !== null}
                    className="rounded-full border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
                  >
                    {busyAction === "variation" ? "Varying..." : "Variations"}
                  </button>
                  <button type="button" onClick={() => downloadImage(selectedAsset)} className="rounded-full border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">
                    Download
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                <h2 className="text-lg font-medium text-stone-950">Edit</h2>
                <textarea
                  value={editorDraft}
                  onChange={(event) => setEditorDraft(event.target.value)}
                  placeholder="Describe one change"
                  className="min-h-[140px] w-full rounded-[1.5rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none placeholder:text-stone-400"
                />
                <button
                  type="button"
                  onClick={() => void runCommand("edit", editorDraft, selectedAssetId, 1)}
                  disabled={!selectedAssetId || busyAction !== null}
                  className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
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