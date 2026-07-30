"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { OrganizationSharedAsset, OrganizationWorkspaceSummary } from "@/lib/organization";

type PersonalLibraryAsset = {
  id: string;
  title: string;
  sourceUrl: string;
  projectName: string;
  createdAt: string;
};

type Props = {
  initialWorkspaces: OrganizationWorkspaceSummary[];
  initialSharedAssets: OrganizationSharedAsset[];
  initialPersonalAssets: PersonalLibraryAsset[];
};

async function safeJson(response: Response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default function OrganizationWorkspace({ initialWorkspaces, initialSharedAssets, initialPersonalAssets }: Props) {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [sharedAssets, setSharedAssets] = useState(initialSharedAssets);
  const [assetWorkspaceSelections, setAssetWorkspaceSelections] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const asset of initialSharedAssets) {
      if (asset.workspaceId) {
        initial[asset.id] = asset.workspaceId;
      }
    }
    return initial;
  });
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [brandGuide, setBrandGuide] = useState("");
  const [approvalMode, setApprovalMode] = useState<"auto" | "required">("auto");
  const [busyAction, setBusyAction] = useState<null | "create" | `share:${string}` | `unshare:${string}`>(null);

  const sharedAssetMap = useMemo(() => new Map(sharedAssets.map((asset) => [asset.id, asset])), [sharedAssets]);
  const organizationStats = useMemo(() => ({
    workspaceCount: workspaces.length,
    sharedAssetCount: sharedAssets.length,
    pendingApprovals: sharedAssets.filter((asset) => asset.approvalStatus === "pending").length,
  }), [sharedAssets, workspaces.length]);

  async function createWorkspace() {
    if (!workspaceName.trim()) {
      toast.error("Workspace name is required.");
      return;
    }

    const toastId = toast.loading("Creating workspace...");
    setBusyAction("create");
    try {
      const response = await fetch("/api/organization/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workspaceName,
          description: workspaceDescription,
          brandGuide,
          approvalMode,
        }),
      });
      const data = await safeJson(response);
      if (!response.ok || !data?.ok || !Array.isArray(data?.workspaces)) {
        throw new Error(data?.error || "Unable to create workspace.");
      }

      setWorkspaces(data.workspaces as OrganizationWorkspaceSummary[]);
      setWorkspaceName("");
      setWorkspaceDescription("");
      setBrandGuide("");
      setApprovalMode("auto");
      toast.success("Workspace created.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create workspace.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  async function updateSharedState(asset: PersonalLibraryAsset, shared: boolean) {
    const workspaceId = shared ? (assetWorkspaceSelections[asset.id] || workspaces[0]?.id || "") : "";
    if (shared && !workspaceId) {
      toast.error("Create a team workspace first.");
      return;
    }

    const action = shared ? `share:${asset.id}` as const : `unshare:${asset.id}` as const;
    const toastId = toast.loading(shared ? "Publishing to shared library..." : "Removing from shared library...");
    setBusyAction(action);
    try {
      const response = await fetch(`/api/organization/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared, workspaceId: workspaceId || null }),
      });
      const data = await safeJson(response);
      if (!response.ok || !data?.ok || !data?.result) {
        throw new Error(data?.error || "Unable to update organization sharing.");
      }

      const workspaceName = workspaceId ? (workspaces.find((workspace) => workspace.id === workspaceId)?.name || null) : null;

      setSharedAssets((current) => {
        if (!shared) {
          return current.filter((item) => item.id !== asset.id);
        }

        const nextAsset: OrganizationSharedAsset = {
          id: asset.id,
          title: asset.title,
          sourceUrl: asset.sourceUrl,
          projectName: asset.projectName,
          createdAt: asset.createdAt,
          workspaceId,
          workspaceName,
          approvalStatus: data.result.approvalStatus === "pending" ? "pending" : "approved",
        };

        return [nextAsset, ...current.filter((item) => item.id !== asset.id)];
      });

      toast.success(shared ? "Published to shared library." : "Removed from shared library.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update organization sharing.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-pink-100 bg-white/88 p-5 shadow-[0_12px_30px_rgba(255,213,115,0.14)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Organization</p>
          <p className="mt-3 text-3xl font-semibold text-[#7a1f4f]">{organizationStats.workspaceCount}</p>
          <p className="mt-2 text-sm text-pink-900/80">Team workspaces</p>
        </div>
        <div className="rounded-3xl border border-pink-100 bg-white/88 p-5 shadow-[0_12px_30px_rgba(255,213,115,0.14)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Shared Library</p>
          <p className="mt-3 text-3xl font-semibold text-[#7a1f4f]">{organizationStats.sharedAssetCount}</p>
          <p className="mt-2 text-sm text-pink-900/80">Published assets</p>
        </div>
        <div className="rounded-3xl border border-pink-100 bg-white/88 p-5 shadow-[0_12px_30px_rgba(255,213,115,0.14)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Approval Workflows</p>
          <p className="mt-3 text-3xl font-semibold text-[#7a1f4f]">{organizationStats.pendingApprovals}</p>
          <p className="mt-2 text-sm text-pink-900/80">Items waiting for approval</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-[2rem] border border-pink-200/80 bg-white/84 p-6 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Team Workspaces</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#7a1f4f]">Create managed spaces for brand and approval rules.</h2>
            </div>
          </div>
          <div className="mt-5 grid gap-3">
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Workspace name"
              className="rounded-[1.25rem] border border-pink-200 bg-[linear-gradient(180deg,_rgba(255,244,250,0.98),_rgba(255,250,214,0.95))] px-4 py-3 text-sm text-[#6d2141] outline-none placeholder:text-pink-300"
            />
            <textarea
              value={workspaceDescription}
              onChange={(event) => setWorkspaceDescription(event.target.value)}
              placeholder="What this team workspace is for"
              className="min-h-[96px] rounded-[1.25rem] border border-pink-200 bg-[linear-gradient(180deg,_rgba(255,244,250,0.98),_rgba(255,250,214,0.95))] px-4 py-3 text-sm text-[#6d2141] outline-none placeholder:text-pink-300"
            />
            <textarea
              value={brandGuide}
              onChange={(event) => setBrandGuide(event.target.value)}
              placeholder="Brand enforcement notes, constraints, voice, palette, forbidden treatments"
              className="min-h-[110px] rounded-[1.25rem] border border-pink-200 bg-[linear-gradient(180deg,_rgba(255,244,250,0.98),_rgba(255,250,214,0.95))] px-4 py-3 text-sm text-[#6d2141] outline-none placeholder:text-pink-300"
            />
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={approvalMode}
                onChange={(event) => setApprovalMode(event.target.value === "required" ? "required" : "auto")}
                className="rounded-full border border-pink-200 bg-white px-4 py-2 text-sm font-medium text-pink-700 outline-none"
              >
                <option value="auto">Auto-approve shared assets</option>
                <option value="required">Require approval before library publish</option>
              </select>
              <button
                type="button"
                onClick={() => void createWorkspace()}
                disabled={busyAction !== null}
                className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(255,95,178,0.28)] disabled:opacity-60"
              >
                {busyAction === "create" ? "Creating..." : "Create workspace"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {workspaces.length ? workspaces.map((workspace) => (
              <article key={workspace.id} className="rounded-[1.5rem] border border-pink-100 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(255,248,216,0.92))] p-4 shadow-[0_10px_24px_rgba(255,213,115,0.16)]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-[#7a1f4f]">{workspace.name}</h3>
                  <span className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-medium text-pink-700">
                    {workspace.approvalMode === "required" ? "Approval required" : "Auto-approved"}
                  </span>
                </div>
                {workspace.description ? (
                  <p className="mt-3 text-sm leading-6 text-pink-900/80">{workspace.description}</p>
                ) : null}
                {workspace.brandGuide ? (
                  <p className="mt-3 rounded-[1.25rem] border border-yellow-200 bg-yellow-50/80 px-3 py-3 text-sm leading-6 text-yellow-900">
                    Brand guide: {workspace.brandGuide}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-pink-500">
                  <span>{workspace.sharedAssetCount} shared assets</span>
                  <span>Updated {formatShortDate(workspace.updatedAt)}</span>
                </div>
              </article>
            )) : (
              <div className="rounded-[1.5rem] border border-dashed border-pink-200 bg-pink-50/60 px-5 py-10 text-sm text-pink-500 md:col-span-2">
                No team workspaces yet. Create one to start a shared library and brand approval flow.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[2rem] border border-pink-200/80 bg-white/84 p-6 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Shared Asset Libraries</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#7a1f4f]">Publish saved assets into organization workspaces.</h2>
          <div className="mt-5 space-y-4">
            {initialPersonalAssets.length ? initialPersonalAssets.map((asset) => {
              const sharedAsset = sharedAssetMap.get(asset.id) || null;
              const selectedWorkspaceId = assetWorkspaceSelections[asset.id] || sharedAsset?.workspaceId || workspaces[0]?.id || "";

              return (
                <article key={asset.id} className="rounded-[1.5rem] border border-pink-100 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(255,248,216,0.92))] p-4 shadow-[0_10px_24px_rgba(255,213,115,0.16)]">
                  <div className="flex gap-4">
                    <img src={asset.sourceUrl} alt={asset.title} className="h-24 w-24 rounded-[1.25rem] border border-pink-200 object-cover" />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-[#7a1f4f]">{formatAssetTitle(asset.createdAt)}</h3>
                      <p className="mt-1 text-xs text-pink-500">{asset.projectName}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                          value={selectedWorkspaceId}
                          onChange={(event) => setAssetWorkspaceSelections((current) => ({ ...current, [asset.id]: event.target.value }))}
                          className="min-w-[180px] rounded-full border border-pink-200 bg-white px-3 py-2 text-sm text-pink-700 outline-none"
                        >
                          {workspaces.length ? workspaces.map((workspace) => (
                            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                          )) : (
                            <option value="">Create a workspace first</option>
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={() => void updateSharedState(asset, true)}
                          disabled={busyAction !== null || !workspaces.length}
                          className="rounded-full border border-pink-300 bg-pink-50 px-3 py-2 text-sm font-medium text-pink-800 hover:bg-pink-100 disabled:opacity-60"
                        >
                          {busyAction === `share:${asset.id}` ? "Publishing..." : sharedAsset ? "Update shared workspace" : "Share"}
                        </button>
                        {sharedAsset ? (
                          <button
                            type="button"
                            onClick={() => void updateSharedState(asset, false)}
                            disabled={busyAction !== null}
                            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                          >
                            {busyAction === `unshare:${asset.id}` ? "Removing..." : "Unshare"}
                          </button>
                        ) : null}
                      </div>
                      {sharedAsset ? (
                        <p className="mt-3 text-xs text-pink-500">
                          {sharedAsset.workspaceName || "Shared"} • {sharedAsset.approvalStatus === "pending" ? "Pending approval" : "Approved"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            }) : (
              <div className="rounded-[1.5rem] border border-dashed border-pink-200 bg-pink-50/60 px-5 py-10 text-sm text-pink-500">
                Save images into your library first, then publish them to an organization workspace here.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-pink-200/80 bg-white/84 p-6 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">Approval Queue</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#7a1f4f]">Shared assets under organization rules.</h2>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sharedAssets.length ? sharedAssets.map((asset) => (
            <article key={asset.id} className="overflow-hidden rounded-[1.5rem] border border-pink-100 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(255,248,216,0.92))] shadow-[0_10px_24px_rgba(255,213,115,0.16)]">
              <img src={asset.sourceUrl} alt={asset.title} className="h-52 w-full object-cover" />
              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[#7a1f4f]">{formatAssetTitle(asset.createdAt)}</h3>
                  <span className={asset.approvalStatus === "pending"
                    ? "rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-900"
                    : "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
                  }>
                    {asset.approvalStatus === "pending" ? "Pending" : "Approved"}
                  </span>
                </div>
                <p className="text-xs text-pink-500">{asset.workspaceName || "Shared organization library"}</p>
                <p className="text-xs text-pink-400">Source: {asset.projectName}</p>
              </div>
            </article>
          )) : (
            <div className="rounded-[1.5rem] border border-dashed border-pink-200 bg-pink-50/60 px-5 py-10 text-sm text-pink-500 md:col-span-2 xl:col-span-3">
              No assets have been published to the shared organization library yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatAssetTitle(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}