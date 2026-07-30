"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { toast } from "sonner";

type StudioProjectSummary = {
  id: string;
  name: string;
  brief: string | null;
  visualDirection: string | null;
  updatedAt: string;
  lastActivityAt: string;
  assetCount: number;
  messageCount: number;
};

type StudioProjectDetail = {
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
    createdAt: string;
  }>;
};

type StudioWorkspaceProps = {
  initialProjects: StudioProjectSummary[];
  initialProjectId: string | null;
  initialProject: StudioProjectDetail | null;
};

type ExportPreset = "png" | "svg" | "pdf" | "favicon" | "social-square" | "social-landscape" | "social-story";

const exportPresets: Array<{ id: ExportPreset; label: string }> = [
  { id: "png", label: "PNG" },
  { id: "svg", label: "SVG" },
  { id: "pdf", label: "PDF" },
  { id: "favicon", label: "Favicon" },
  { id: "social-square", label: "Square social" },
  { id: "social-landscape", label: "Open Graph" },
  { id: "social-story", label: "Story" },
];

export default function StudioWorkspace({ initialProjects, initialProjectId, initialProject }: StudioWorkspaceProps) {
  const [projects, setProjects] = useState(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState(initialProjectId);
  const [activeProject, setActiveProject] = useState(initialProject);
  const [projectNameDraft, setProjectNameDraft] = useState(initialProject?.name || "");
  const [projectBriefDraft, setProjectBriefDraft] = useState(initialProject?.brief || "");
  const [projectDirectionDraft, setProjectDirectionDraft] = useState(initialProject?.visualDirection || "");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectBrief, setNewProjectBrief] = useState("");
  const [newProjectDirection, setNewProjectDirection] = useState("");
  const [commandDraft, setCommandDraft] = useState("");
  const [assetQuery, setAssetQuery] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(initialProject?.assets[0]?.id || null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [sendingCommand, setSendingCommand] = useState(false);
  const [exportingPreset, setExportingPreset] = useState<ExportPreset | null>(null);
  const deferredAssetQuery = useDeferredValue(assetQuery);

  useEffect(() => {
    setProjectNameDraft(activeProject?.name || "");
    setProjectBriefDraft(activeProject?.brief || "");
    setProjectDirectionDraft(activeProject?.visualDirection || "");
    setSelectedAssetId((current) => current && activeProject?.assets.some((asset) => asset.id === current) ? current : activeProject?.assets[0]?.id || null);
  }, [activeProject]);

  useEffect(() => {
    if (!activeProjectId) return;
    setLoadingProject(true);
    void fetch(`/api/studio/projects/${activeProjectId}${deferredAssetQuery ? `?q=${encodeURIComponent(deferredAssetQuery)}` : ""}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || !data?.project) {
          throw new Error(data?.error || "Project loading failed.");
        }
        startTransition(() => setActiveProject(data.project as StudioProjectDetail));
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Project loading failed.");
      })
      .finally(() => setLoadingProject(false));
  }, [activeProjectId, deferredAssetQuery]);

  const selectedAsset = activeProject?.assets.find((asset) => asset.id === selectedAssetId) ?? activeProject?.assets[0] ?? null;

  async function createProject() {
    if (!newProjectName.trim()) {
      toast.error("Project name is required.");
      return;
    }

    setCreatingProject(true);
    try {
      const response = await fetch("/api/studio/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProjectName,
          brief: newProjectBrief,
          visualDirection: newProjectDirection,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        throw new Error(data?.error || "Project creation failed.");
      }

      const nextProject = data.project as StudioProjectSummary;
      startTransition(() => {
        setProjects((current) => [nextProject, ...current.filter((item) => item.id !== nextProject.id)]);
        setActiveProjectId(nextProject.id);
      });
      setNewProjectName("");
      setNewProjectBrief("");
      setNewProjectDirection("");
      toast.success("Project created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Project creation failed.");
    } finally {
      setCreatingProject(false);
    }
  }

  async function saveProjectSettings() {
    if (!activeProjectId) return;
    setSavingProject(true);
    try {
      const response = await fetch(`/api/studio/projects/${activeProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectNameDraft,
          brief: projectBriefDraft,
          visualDirection: projectDirectionDraft,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        throw new Error(data?.error || "Project update failed.");
      }

      const project = data.project as StudioProjectDetail;
      setActiveProject(project);
      setProjects((current) => current.map((item) => item.id === project.id ? {
        ...item,
        name: project.name,
        brief: project.brief,
        visualDirection: project.visualDirection,
        updatedAt: project.updatedAt,
        lastActivityAt: project.lastActivityAt,
        assetCount: project.assetCount,
        messageCount: project.messageCount,
      } : item));
      toast.success("Project updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Project update failed.");
    } finally {
      setSavingProject(false);
    }
  }

  async function sendCommand() {
    if (!activeProjectId) {
      toast.error("Create a project first.");
      return;
    }
    if (!commandDraft.trim()) {
      toast.error("Add a prompt or edit instruction first.");
      return;
    }

    setSendingCommand(true);
    try {
      const response = await fetch(`/api/studio/projects/${activeProjectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: commandDraft,
          assetId: selectedAssetId,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        throw new Error(data?.error || "Studio command failed.");
      }

      const project = data.project as StudioProjectDetail;
      setActiveProject(project);
      setProjects((current) => {
        const existing = current.find((item) => item.id === project.id);
        const summary: StudioProjectSummary = {
          id: project.id,
          name: project.name,
          brief: project.brief,
          visualDirection: project.visualDirection,
          updatedAt: project.updatedAt,
          lastActivityAt: project.lastActivityAt,
          assetCount: project.assetCount,
          messageCount: project.messageCount,
        };

        if (!existing) return [summary, ...current];
        return [summary, ...current.filter((item) => item.id !== project.id)];
      });
      if (typeof data.createdAssetId === "string") {
        setSelectedAssetId(data.createdAssetId);
      }
      setCommandDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Studio command failed.");
    } finally {
      setSendingCommand(false);
    }
  }

  async function exportSelectedAsset(preset: ExportPreset) {
    if (!selectedAsset) {
      toast.error("Select an asset first.");
      return;
    }

    setExportingPreset(preset);
    try {
      const image = await loadImage(selectedAsset.sourceUrl);

      if (preset === "svg") {
        const width = selectedAsset.width || image.naturalWidth || 1024;
        const height = selectedAsset.height || image.naturalHeight || 1024;
        const svg = [
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
          `<image href="${escapeXml(selectedAsset.sourceUrl)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />`,
          "</svg>",
        ].join("");
        downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${slugify(selectedAsset.title)}.svg`);
        return;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas export is unavailable.");

      const { width, height } = getPresetSize(preset, image.naturalWidth || 1024, image.naturalHeight || 1024);
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      drawContainedImage(ctx, image, width, height);

      if (preset === "pdf") {
        const pngBytes = await blobToUint8Array(await canvasToBlob(canvas, "image/png"));
        const pdf = await PDFDocument.create();
        const embedded = await pdf.embedPng(pngBytes);
        const page = pdf.addPage([width, height]);
        page.drawImage(embedded, { x: 0, y: 0, width, height });
        const pdfBytes = await pdf.save();
        downloadBlob(new Blob([pdfBytes], { type: "application/pdf" }), `${slugify(selectedAsset.title)}.pdf`);
        return;
      }

      const blob = await canvasToBlob(canvas, "image/png");
      downloadBlob(blob, `${slugify(selectedAsset.title)}${preset === "favicon" ? "-favicon" : preset.startsWith("social") ? `-${preset}` : ""}.png`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExportingPreset(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
      <aside className="space-y-4">
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Projects</p>
          <div className="mt-4 space-y-3">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setActiveProjectId(project.id)}
                className={project.id === activeProjectId
                  ? "w-full rounded-3xl border border-emerald-300 bg-emerald-50 px-4 py-4 text-left"
                  : "w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-left hover:bg-slate-100"
                }
              >
                <p className="text-sm font-semibold text-slate-950">{project.name}</p>
                <p className="mt-2 text-xs leading-5 text-slate-600">{truncate(project.brief || project.visualDirection || "No brief yet.", 96)}</p>
                <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-slate-500">{project.assetCount} assets • {project.messageCount} turns</p>
              </button>
            ))}
            {!projects.length ? (
              <div className="rounded-3xl border border-dashed border-slate-300 px-4 py-5 text-sm leading-6 text-slate-600">
                Create your first project to start collecting prompts, edits, assets, and exports in one place.
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">New project</p>
          <div className="mt-4 space-y-3">
            <input
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="Launch campaign look-dev"
              className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
            />
            <textarea
              value={newProjectBrief}
              onChange={(event) => setNewProjectBrief(event.target.value)}
              placeholder="What is this project trying to create?"
              className="min-h-[88px] w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
            />
            <textarea
              value={newProjectDirection}
              onChange={(event) => setNewProjectDirection(event.target.value)}
              placeholder="Visual direction, references, palette, camera language"
              className="min-h-[88px] w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
            />
            <button
              type="button"
              onClick={() => void createProject()}
              disabled={creatingProject}
              className="w-full rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {creatingProject ? "Creating..." : "Create project"}
            </button>
          </div>
        </section>
      </aside>

      <section className="space-y-4">
        <div className="rounded-[2rem] border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-orange-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Studio MVP</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Clerk-authenticated creative workflow with project memory, image generation, natural-language edits, and export-ready history.</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-700">
            Use each project as the container for art direction, AI commands, derivative image edits, searchable assets, and export presets. Type prompts like “launch a moody citrus campaign still life” or “make this blue and remove the background”.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Project settings</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">{activeProject?.name || "Select a project"}</h2>
              </div>
              {loadingProject ? <span className="text-xs text-slate-500">Syncing...</span> : null}
            </div>
            <div className="mt-4 space-y-3">
              <input
                value={projectNameDraft}
                onChange={(event) => setProjectNameDraft(event.target.value)}
                placeholder="Project name"
                disabled={!activeProject}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-slate-50"
              />
              <textarea
                value={projectBriefDraft}
                onChange={(event) => setProjectBriefDraft(event.target.value)}
                placeholder="Creative brief"
                disabled={!activeProject}
                className="min-h-[92px] w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-slate-50"
              />
              <textarea
                value={projectDirectionDraft}
                onChange={(event) => setProjectDirectionDraft(event.target.value)}
                placeholder="Visual direction"
                disabled={!activeProject}
                className="min-h-[92px] w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none disabled:bg-slate-50"
              />
              <button
                type="button"
                onClick={() => void saveProjectSettings()}
                disabled={!activeProject || savingProject}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                {savingProject ? "Saving..." : "Save project settings"}
              </button>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Conversation</p>
            <div className="mt-4 max-h-[340px] space-y-3 overflow-y-auto rounded-3xl border border-slate-200 bg-slate-50 p-4">
              {activeProject?.messages.length ? activeProject.messages.map((message) => (
                <div key={message.id} className={message.role === "assistant"
                  ? "rounded-3xl border border-cyan-200 bg-cyan-50 px-4 py-3"
                  : "rounded-3xl border border-slate-200 bg-white px-4 py-3"
                }>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{message.role === "assistant" ? "Studio" : "You"} • {formatDate(message.createdAt)}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-800">{message.content}</p>
                </div>
              )) : (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm leading-6 text-slate-600">
                  Project conversation history appears here. Every prompt, edit instruction, and AI reply stays attached to the current project.
                </div>
              )}
            </div>
            <div className="mt-4 space-y-3">
              <textarea
                value={commandDraft}
                onChange={(event) => setCommandDraft(event.target.value)}
                placeholder="Generate a dramatic fragrance campaign still life. Or: make this blue, remove the background, and add alpine mountains."
                disabled={!activeProject}
                className="min-h-[120px] w-full rounded-3xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-50"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void sendCommand()}
                  disabled={!activeProject || sendingCommand}
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {sendingCommand ? "Processing..." : "Run studio command"}
                </button>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
                  {selectedAsset ? `Editing target: ${selectedAsset.title}` : "No asset selected yet"}
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-[1.75rem] border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-800">Asset library</p>
          <input
            value={assetQuery}
            onChange={(event) => setAssetQuery(event.target.value)}
            placeholder="Search prompts, tags, or edits"
            className="mt-4 w-full rounded-2xl border border-cyan-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
          />
          <div className="mt-4 grid max-h-[560px] gap-3 overflow-y-auto pr-1">
            {activeProject?.assets.length ? activeProject.assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setSelectedAssetId(asset.id)}
                className={asset.id === selectedAssetId
                  ? "overflow-hidden rounded-3xl border border-cyan-400 bg-white text-left shadow-sm"
                  : "overflow-hidden rounded-3xl border border-cyan-200 bg-white text-left shadow-sm hover:border-cyan-300"
                }
              >
                <img src={asset.sourceUrl} alt={asset.title} className="h-40 w-full object-cover" />
                <div className="space-y-2 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-950">{asset.title}</p>
                  <p className="text-xs leading-5 text-slate-600">{truncate(asset.enhancedPrompt || asset.prompt || "No prompt recorded.", 120)}</p>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{asset.tags.join(" • ") || "image"}</p>
                </div>
              </button>
            )) : (
              <div className="rounded-3xl border border-dashed border-cyan-300 bg-white px-4 py-6 text-sm leading-6 text-slate-600">
                Generated and edited assets appear here with searchable prompt history.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Export</p>
          {selectedAsset ? (
            <>
              <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                <img src={selectedAsset.sourceUrl} alt={selectedAsset.title} className="h-48 w-full object-cover" />
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-950">{selectedAsset.title}</p>
              <p className="mt-2 text-xs leading-5 text-slate-600">{truncate(selectedAsset.enhancedPrompt || selectedAsset.prompt || "", 160)}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {exportPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => void exportSelectedAsset(preset.id)}
                    disabled={exportingPreset !== null}
                    className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {exportingPreset === preset.id ? "Exporting..." : preset.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-3xl border border-dashed border-slate-300 px-4 py-6 text-sm leading-6 text-slate-600">
              Select an asset to export PNG, SVG wrapper, PDF, favicon, or common social media sizes in one click.
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "studio-asset";
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadImage(sourceUrl: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = sourceUrl;
  await image.decode();
  return image;
}

function getPresetSize(preset: ExportPreset, fallbackWidth: number, fallbackHeight: number) {
  if (preset === "favicon") return { width: 64, height: 64 };
  if (preset === "social-square") return { width: 1200, height: 1200 };
  if (preset === "social-landscape") return { width: 1200, height: 630 };
  if (preset === "social-story") return { width: 1080, height: 1920 };
  return { width: fallbackWidth, height: fallbackHeight };
}

function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number
) {
  const ratio = Math.min(canvasWidth / image.naturalWidth, canvasHeight / image.naturalHeight);
  const drawWidth = image.naturalWidth * ratio;
  const drawHeight = image.naturalHeight * ratio;
  const drawX = (canvasWidth - drawWidth) / 2;
  const drawY = (canvasHeight - drawHeight) / 2;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.96));
  if (!blob) throw new Error("Export failed to produce a file.");
  return blob;
}

async function blobToUint8Array(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}