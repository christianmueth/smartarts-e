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
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const favoriteCount = activeProject?.assets.filter((asset) => asset.isFavorite).length || 0;
  const editCount = activeProject?.assets.filter((asset) => asset.mode === "edit").length || 0;
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
        setDrawerOpen(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleFavorite(assetId: string, favorite: boolean) {
    setBusyAction(`favorite:${assetId}`);
    try {
      const response = await fetch(`/api/studio/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        throw new Error(data?.error || "Favorite update failed.");
      }
      const project = data.project as ProjectDetail;
      setActiveProject(project);
      setProjects((current) => current.map((item) => item.id === project.id ? {
        ...item,
        assetCount: project.assetCount,
        messageCount: project.messageCount,
        updatedAt: project.updatedAt,
        lastActivityAt: project.lastActivityAt,
      } : item));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Favorite update failed.");
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.12),_transparent_26%),radial-gradient(circle_at_80%_15%,_rgba(56,189,248,0.14),_transparent_24%),linear-gradient(180deg,_#fffaf4_0%,_#fff4e8_54%,_#f7efe7_100%)] text-stone-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pb-28 pt-8 md:px-6 md:pt-12">
        <section className="rounded-[2.25rem] border border-white/70 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <p className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-orange-700">One prompt to create. One sentence to edit.</p>
              <h1 className="font-serif text-5xl leading-none tracking-[-0.04em] text-stone-950 sm:text-6xl">The homepage is the studio.</h1>
              <p className="max-w-2xl text-base leading-8 text-stone-700 sm:text-lg">Type what you want, optionally add a reference image, generate four directions, then keep refining with one-line AI edits.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[320px]">
              <StatCard label="Saved projects" value={signedIn ? String(projects.length) : "Sign in"} />
              <StatCard label="Generation history" value={signedIn ? String(activeProject?.assetCount || 0) : "4-up results"} />
              <StatCard label="Favorite images" value={signedIn ? String(favoriteCount) : "Save what works"} />
              <StatCard label="AI edit history" value={signedIn ? String(editCount) : "Conversational"} />
            </div>
          </div>

          {signedIn ? (
            <div className="mt-6 flex flex-wrap gap-3">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setActiveProjectId(project.id)}
                  className={project.id === activeProjectId
                    ? "rounded-full border border-stone-900 bg-stone-900 px-4 py-2 text-sm font-medium text-white"
                    : "rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
                  }
                >
                  {project.name}
                </button>
              ))}
              {!projects.length ? (
                <div className="rounded-full border border-dashed border-stone-300 px-4 py-2 text-sm text-stone-600">Your first project will be created automatically when you generate.</div>
              ) : null}
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap gap-3">
              <SignInButton mode="modal" forceRedirectUrl="/" signUpForceRedirectUrl="/">
                <button className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-white hover:bg-stone-800">Sign in to generate</button>
              </SignInButton>
              <SignInButton mode="modal" forceRedirectUrl="/" signUpForceRedirectUrl="/">
                <button className="rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-900 hover:bg-stone-50">Save projects and history</button>
              </SignInButton>
            </div>
          )}

          <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_280px]">
            <div className="rounded-[1.8rem] border border-stone-200 bg-stone-950 p-5 text-white shadow-sm">
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-200">Prompt</label>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What would you like to create?"
                className="mt-4 min-h-[180px] w-full resize-none rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4 text-lg text-white outline-none placeholder:text-stone-400"
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center rounded-full border border-white/15 bg-white/8 px-4 py-2 text-sm font-medium text-white hover:bg-white/12">
                  Upload reference image
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleReferenceUpload(event.target.files?.[0] || null)} />
                </label>
                {referenceImageName ? (
                  <button type="button" onClick={() => void handleReferenceUpload(null)} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-200 hover:bg-white/8">
                    Clear {referenceImageName}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void runCommand("generate", prompt, null, 4)}
                  disabled={busyAction !== null || loadingProject}
                  className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-stone-950 hover:bg-stone-100 disabled:opacity-60"
                >
                  {busyAction === "generate" ? "Generating 4 images..." : "Generate"}
                </button>
              </div>
            </div>

            <div className="rounded-[1.8rem] border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Active project</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">{activeProject?.name || "Ready to start"}</h2>
              <p className="mt-3 text-sm leading-7 text-stone-600">{activeProject?.brief || "Generate once and SmartArts will create a simple project automatically. Use the same project to keep your images, favorites, and edit history together."}</p>
              {referenceImageDataUrl ? (
                <div className="mt-4 overflow-hidden rounded-[1.4rem] border border-stone-200 bg-stone-50">
                  <img src={referenceImageDataUrl} alt={referenceImageName || "Reference image"} className="h-40 w-full object-cover" />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-[2.2rem] border border-stone-200 bg-white/90 p-6 shadow-sm backdrop-blur md:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Results</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-stone-950">Four directions, minimal choices.</h2>
            </div>
            {loadingProject ? <span className="text-sm text-stone-500">Refreshing...</span> : null}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {results.length ? results.map((asset) => (
              <article key={asset.id} className={asset.id === selectedAssetId
                ? "overflow-hidden rounded-[1.8rem] border border-stone-950 bg-white shadow-sm"
                : "overflow-hidden rounded-[1.8rem] border border-stone-200 bg-white shadow-sm"
              }>
                <button type="button" onClick={() => setSelectedAssetId(asset.id)} className="block w-full text-left">
                  <img src={asset.sourceUrl} alt={asset.title} className="h-64 w-full object-cover" />
                </button>
                <div className="space-y-3 px-4 py-4">
                  <div>
                    <p className="text-sm font-semibold text-stone-950">{asset.title}</p>
                    <p className="mt-1 text-xs leading-5 text-stone-600">{truncate(asset.enhancedPrompt || asset.prompt || "Generated result", 88)}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleFavorite(asset.id, !asset.isFavorite)}
                      disabled={busyAction === `favorite:${asset.id}`}
                      className={asset.isFavorite
                        ? "rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
                        : "rounded-full border border-stone-300 px-3 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50"
                      }
                    >
                      {asset.isFavorite ? "Saved" : "Save"}
                    </button>
                    <button type="button" onClick={() => { setSelectedAssetId(asset.id); setDrawerOpen(true); }} className="rounded-full border border-stone-300 px-3 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50">
                      Edit with AI
                    </button>
                    <button type="button" onClick={() => downloadImage(asset)} className="rounded-full border border-stone-300 px-3 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50">
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => void runCommand("variation", `Create four variations of this image. Keep the core subject, structure, and visual intent intact while exploring fresh treatments.`, asset.id, 4)}
                      disabled={busyAction !== null}
                      className="rounded-full border border-stone-300 px-3 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:opacity-60"
                    >
                      {busyAction === "variation" ? "Varying..." : "Variations"}
                    </button>
                  </div>
                </div>
              </article>
            )) : (
              <div className="md:col-span-2 xl:col-span-4 rounded-[1.8rem] border border-dashed border-stone-300 bg-stone-50 px-6 py-14 text-center text-sm leading-7 text-stone-600">
                Generate a prompt to populate four image directions here. Each result keeps its own edit history.
              </div>
            )}
          </div>
        </section>
      </div>

      <div className={drawerOpen ? "fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/97 shadow-[0_-18px_50px_rgba(15,23,42,0.10)] backdrop-blur" : "fixed bottom-4 right-4 z-40"}>
        {drawerOpen ? (
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 md:grid-cols-[280px_minmax(0,1fr)] md:px-6">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">AI Editor</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">Conversational editing</h3>
                </div>
                <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-full border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-900 hover:bg-stone-50">Close</button>
              </div>
              {selectedAsset ? (
                <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-stone-200 bg-stone-50">
                  <img src={selectedAsset.sourceUrl} alt={selectedAsset.title} className="h-52 w-full object-cover" />
                </div>
              ) : null}
            </div>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  "Remove the background.",
                  "Make it watercolor.",
                  "Turn it into a logo.",
                  "Add mountains.",
                ].map((example) => (
                  <button key={example} type="button" onClick={() => setEditorDraft(example)} className="rounded-full border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">
                    {example}
                  </button>
                ))}
              </div>
              <textarea
                value={editorDraft}
                onChange={(event) => setEditorDraft(event.target.value)}
                placeholder="Describe the next change in one sentence."
                className="min-h-[128px] w-full rounded-[1.5rem] border border-stone-300 px-4 py-3 text-sm text-stone-900 outline-none"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void runCommand("edit", editorDraft, selectedAssetId, 1)}
                  disabled={!selectedAssetId || busyAction !== null}
                  className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
                >
                  {busyAction === "edit" ? "Applying edit..." : "Apply AI edit"}
                </button>
                <div className="text-sm text-stone-500">Each edit creates a new version while preserving history.</div>
              </div>
              <div className="max-h-[220px] space-y-3 overflow-y-auto rounded-[1.5rem] border border-stone-200 bg-stone-50 p-4">
                {activeProject?.messages.length ? activeProject.messages.slice(-8).reverse().map((message) => (
                  <div key={message.id} className={message.role === "assistant"
                    ? "rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3"
                    : "rounded-2xl border border-stone-200 bg-white px-4 py-3"
                  }>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{message.role === "assistant" ? "AI" : "You"}</p>
                    <p className="mt-2 text-sm leading-6 text-stone-800">{message.content}</p>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-5 text-sm leading-6 text-stone-600">
                    Your edit history will appear here once you start refining results.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setDrawerOpen(true)} className="rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-900 shadow-lg hover:bg-stone-50">
            Open AI Editor
          </button>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.4rem] border border-stone-200 bg-white px-4 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">{value}</p>
    </div>
  );
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "smartarts-image";
}