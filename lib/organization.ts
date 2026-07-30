import { Prisma } from "@prisma/client";
import { getBillingSnapshotForClerkUser } from "@/lib/billing";
import { isMissingTableOrColumnError, prisma } from "@/lib/db";

export const ORGANIZATION_WORKSPACE_STATUS = "organization-workspace";

export type OrganizationWorkspaceSummary = {
  id: string;
  name: string;
  description: string | null;
  brandGuide: string | null;
  approvalMode: "auto" | "required";
  sharedAssetCount: number;
  updatedAt: string;
};

export type OrganizationSharedAsset = {
  id: string;
  title: string;
  sourceUrl: string;
  projectName: string;
  createdAt: string;
  workspaceId: string | null;
  workspaceName: string | null;
  approvalStatus: "approved" | "pending";
};

export async function requireOrganizationAccessForClerkUser(clerkUserId: string) {
  const billing = await getBillingSnapshotForClerkUser(clerkUserId);
  if (!billing.isOrganization) {
    throw new Error("Organization billing is required for this feature.");
  }
  return billing;
}

export async function listOrganizationWorkspacesForClerkUser(clerkUserId: string): Promise<OrganizationWorkspaceSummary[]> {
  await requireOrganizationAccessForClerkUser(clerkUserId);

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });
  if (!user) {
    return [];
  }

  const workspaces = await prisma.project.findMany({
    where: {
      userId: user.id,
      status: ORGANIZATION_WORKSPACE_STATUS,
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      brief: true,
      metadata: true,
      updatedAt: true,
    },
  });

  const assets = await prisma.projectAsset.findMany({
    where: {
      project: {
        userId: user.id,
      },
    },
    select: {
      metadata: true,
    },
  });

  const sharedCounts = new Map<string, number>();
  for (const asset of assets) {
    const metadata = asRecord(asset.metadata);
    if (!readSavedFlag(metadata) || metadata.sharedLibrary !== true) {
      continue;
    }

    const workspaceId = cleanString(metadata.organizationWorkspaceId);
    if (!workspaceId) {
      continue;
    }
    sharedCounts.set(workspaceId, (sharedCounts.get(workspaceId) || 0) + 1);
  }

  return workspaces.map((workspace) => {
    const metadata = asRecord(workspace.metadata);
    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.brief,
      brandGuide: cleanString(metadata.brandGuide) || null,
      approvalMode: metadata.approvalMode === "required" ? "required" : "auto",
      sharedAssetCount: sharedCounts.get(workspace.id) || 0,
      updatedAt: workspace.updatedAt.toISOString(),
    };
  });
}

export async function createOrganizationWorkspaceForClerkUser(input: {
  clerkUserId: string;
  name: string;
  description?: string | null;
  brandGuide?: string | null;
  approvalMode?: string | null;
}) {
  await requireOrganizationAccessForClerkUser(input.clerkUserId);

  const user = await prisma.user.findUnique({
    where: { clerkUserId: input.clerkUserId },
    select: { id: true },
  });
  if (!user) {
    throw new Error("User not found.");
  }

  const name = cleanString(input.name).slice(0, 120);
  if (!name) {
    throw new Error("Workspace name is required.");
  }

  const description = cleanString(input.description).slice(0, 800) || null;
  const brandGuide = cleanString(input.brandGuide).slice(0, 800) || null;
  const approvalMode = input.approvalMode === "required" ? "required" : "auto";

  await prisma.project.create({
    data: {
      userId: user.id,
      name,
      brief: description,
      status: ORGANIZATION_WORKSPACE_STATUS,
      searchText: [name, description, brandGuide, approvalMode].filter(Boolean).join(" "),
      metadata: {
        brandGuide,
        approvalMode,
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return listOrganizationWorkspacesForClerkUser(input.clerkUserId);
}

export async function listOrganizationSharedAssetsForClerkUser(clerkUserId: string): Promise<OrganizationSharedAsset[]> {
  await requireOrganizationAccessForClerkUser(clerkUserId);

  let assets: Array<{
    id: string;
    title: string;
    sourceUrl: string;
    createdAt: Date;
    metadata: Prisma.JsonValue;
    project: { name: string };
  }> = [];

  try {
    assets = await prisma.projectAsset.findMany({
      where: {
        project: {
          user: { clerkUserId },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        sourceUrl: true,
        createdAt: true,
        metadata: true,
        project: { select: { name: true } },
      },
    });
  } catch (error) {
    if (!isMissingTableOrColumnError(error, ["ProjectAsset", "Project"])) {
      throw error;
    }
    return [];
  }

  const workspaces = await listOrganizationWorkspacesForClerkUser(clerkUserId);
  const workspaceMap = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));

  return assets
    .map((asset) => {
      const metadata = asRecord(asset.metadata);
      if (!readSavedFlag(metadata) || metadata.sharedLibrary !== true) {
        return null;
      }

      const workspaceId = cleanString(metadata.organizationWorkspaceId) || null;
      const approvalStatus = metadata.approvalStatus === "pending" ? "pending" : "approved";

      return {
        id: asset.id,
        title: asset.title,
        sourceUrl: asset.sourceUrl,
        projectName: asset.project.name,
        createdAt: asset.createdAt.toISOString(),
        workspaceId,
        workspaceName: workspaceId ? workspaceMap.get(workspaceId) || null : null,
        approvalStatus,
      } satisfies OrganizationSharedAsset;
    })
    .filter((asset): asset is OrganizationSharedAsset => Boolean(asset));
}

export async function shareStudioAssetToOrganizationWorkspaceForClerkUser(input: {
  clerkUserId: string;
  assetId: string;
  workspaceId?: string | null;
  shared: boolean;
}) {
  await requireOrganizationAccessForClerkUser(input.clerkUserId);

  const asset = await prisma.projectAsset.findFirst({
    where: {
      id: input.assetId,
      project: {
        user: { clerkUserId: input.clerkUserId },
      },
    },
    select: {
      id: true,
      metadata: true,
    },
  });

  if (!asset) {
    throw new Error("Asset not found.");
  }

  const metadata = asRecord(asset.metadata);
  if (!readSavedFlag(metadata)) {
    throw new Error("Save the asset to your library before sharing it.");
  }

  const workspaceId = input.shared ? cleanString(input.workspaceId) : "";
  let approvalStatus: "approved" | "pending" = "approved";
  if (workspaceId) {
    const workspace = await prisma.project.findFirst({
      where: {
        id: workspaceId,
        status: ORGANIZATION_WORKSPACE_STATUS,
        user: { clerkUserId: input.clerkUserId },
      },
      select: {
        id: true,
        metadata: true,
      },
    });
    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    const workspaceMetadata = asRecord(workspace.metadata);
    approvalStatus = workspaceMetadata.approvalMode === "required" ? "pending" : "approved";
  }

  await prisma.projectAsset.update({
    where: { id: asset.id },
    data: {
      metadata: {
        ...metadata,
        sharedLibrary: input.shared,
        organizationWorkspaceId: workspaceId || null,
        approvalStatus: input.shared ? approvalStatus : null,
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return {
    assetId: asset.id,
    shared: input.shared,
    workspaceId: workspaceId || null,
    approvalStatus: input.shared ? approvalStatus : null,
  };
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function readSavedFlag(metadata: Record<string, unknown>) {
  return metadata.saved === true || metadata.favorite === true;
}