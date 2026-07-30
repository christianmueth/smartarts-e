import { Prisma } from "@prisma/client";
import { callLLMResult } from "@/lib/aiClient";
import { isMissingTableOrColumnError, prisma, safeUpsertUser } from "@/lib/db";

const PROJECT_LIST_LIMIT = 24;
const PROJECT_MESSAGE_LIMIT = 60;
const PROJECT_ASSET_LIMIT = 36;

const studioCommandSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["generate", "edit", "chat"] },
    title: { type: "string" },
    assistantReply: { type: "string" },
    prompt: { type: "string" },
    tags: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
  },
  required: ["mode", "title", "assistantReply", "prompt", "tags"],
} as const;

type StudioCommandPlan = {
  mode: "generate" | "edit" | "chat";
  title: string;
  assistantReply: string;
  prompt: string;
  tags: string[];
};

export type StudioProjectSummary = {
  id: string;
  name: string;
  brief: string | null;
  visualDirection: string | null;
  updatedAt: string;
  lastActivityAt: string;
  assetCount: number;
  messageCount: number;
};

export type StudioProjectDetail = {
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

export async function listStudioProjectsForClerkUser(clerkUserId: string): Promise<StudioProjectSummary[]> {
  let user: { id: string } | null = null;
  try {
    user = await prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true },
    });
  } catch (error) {
    if (!isMissingTableOrColumnError(error, ["User"])) {
      throw error;
    }
    console.warn("[studio] User table unavailable; returning empty project list");
    return [];
  }

  if (!user) return [];

  let projects: Array<{
    id: string;
    name: string;
    brief: string | null;
    visualDirection: string | null;
    updatedAt: Date;
    lastActivityAt: Date;
    _count: { assets: number; messages: number };
  }> = [];

  try {
    projects = await prisma.project.findMany({
      where: { userId: user.id },
      orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
      take: PROJECT_LIST_LIMIT,
      select: {
        id: true,
        name: true,
        brief: true,
        visualDirection: true,
        updatedAt: true,
        lastActivityAt: true,
        _count: { select: { assets: true, messages: true } },
      },
    });
  } catch (error) {
    if (!isMissingTableOrColumnError(error, ["Project", "ProjectAsset", "ProjectMessage", "lastActivityAt"])) {
      throw error;
    }
    console.warn("[studio] Project tables unavailable; returning empty project list");
    return [];
  }

  return projects.map(mapProjectSummary);
}

export async function getStudioProjectDetailForClerkUser(
  clerkUserId: string,
  projectId: string,
  assetQuery?: string | null
): Promise<StudioProjectDetail | null> {
  const trimmedQuery = cleanText(assetQuery, 120);
  let project: {
    id: string;
    name: string;
    brief: string | null;
    visualDirection: string | null;
    status: string;
    updatedAt: Date;
    lastActivityAt: Date;
    messages: Array<{ id: string; role: string; content: string; commandType: string | null; createdAt: Date }>;
    assets: Array<{ id: string; kind: string; title: string; sourceUrl: string; prompt: string | null; enhancedPrompt: string | null; mimeType: string | null; width: number | null; height: number | null; tags: string[]; createdAt: Date }>;
    _count: { assets: number; messages: number };
  } | null = null;

  try {
    project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user: { clerkUserId },
      },
      select: {
        id: true,
        name: true,
        brief: true,
        visualDirection: true,
        status: true,
        updatedAt: true,
        lastActivityAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          take: PROJECT_MESSAGE_LIMIT,
          select: {
            id: true,
            role: true,
            content: true,
            commandType: true,
            createdAt: true,
          },
        },
        assets: {
          where: trimmedQuery
            ? {
                OR: [
                  { title: { contains: trimmedQuery, mode: "insensitive" } },
                  { prompt: { contains: trimmedQuery, mode: "insensitive" } },
                  { enhancedPrompt: { contains: trimmedQuery, mode: "insensitive" } },
                  { searchText: { contains: trimmedQuery, mode: "insensitive" } },
                  { tags: { hasSome: trimmedQuery.split(/\s+/).filter(Boolean).slice(0, 6) } },
                ],
              }
            : undefined,
          orderBy: { createdAt: "desc" },
          take: PROJECT_ASSET_LIMIT,
          select: {
            id: true,
            kind: true,
            title: true,
            sourceUrl: true,
            prompt: true,
            enhancedPrompt: true,
            mimeType: true,
            width: true,
            height: true,
            tags: true,
            metadata: true,
            createdAt: true,
          },
        },
        _count: { select: { assets: true, messages: true } },
      },
    });
  } catch (error) {
    if (!isMissingTableOrColumnError(error, ["Project", "ProjectAsset", "ProjectMessage", "lastActivityAt", "searchText"])) {
      throw error;
    }
    console.warn("[studio] Project tables unavailable; returning null project detail");
    return null;
  }

  if (!project) return null;

  return {
    id: project.id,
    name: project.name,
    brief: project.brief,
    visualDirection: project.visualDirection,
    status: project.status,
    updatedAt: project.updatedAt.toISOString(),
    lastActivityAt: project.lastActivityAt.toISOString(),
    assetCount: project._count.assets,
    messageCount: project._count.messages,
    messages: project.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      commandType: message.commandType,
      createdAt: message.createdAt.toISOString(),
    })),
    assets: project.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      title: asset.title,
      sourceUrl: asset.sourceUrl,
      prompt: asset.prompt,
      enhancedPrompt: asset.enhancedPrompt,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      tags: asset.tags,
      isFavorite: readAssetMetadataFlag(asset.metadata, "favorite"),
      mode: readAssetMetadataString(asset.metadata, "mode"),
      createdAt: asset.createdAt.toISOString(),
    })),
  };
}

export async function createStudioProjectForClerkUser(input: {
  clerkUserId: string;
  name: string;
  brief?: string | null;
  visualDirection?: string | null;
}) {
  const user = await safeUpsertUser(input.clerkUserId, { id: true });
  if (!user) {
    throw new Error("User persistence is unavailable right now.");
  }

  const name = cleanText(input.name, 120);
  if (!name) {
    throw new Error("Project name is required.");
  }

  const brief = cleanText(input.brief, 800) || null;
  const visualDirection = cleanText(input.visualDirection, 800) || null;

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name,
      brief,
      visualDirection,
      searchText: buildSearchText(name, brief, visualDirection),
    },
    select: {
      id: true,
      name: true,
      brief: true,
      visualDirection: true,
      updatedAt: true,
      lastActivityAt: true,
      _count: { select: { assets: true, messages: true } },
    },
  });

  return mapProjectSummary(project);
}

export async function updateStudioProjectForClerkUser(input: {
  clerkUserId: string;
  projectId: string;
  name?: string | null;
  brief?: string | null;
  visualDirection?: string | null;
}) {
  const existing = await prisma.project.findFirst({
    where: { id: input.projectId, user: { clerkUserId: input.clerkUserId } },
    select: { id: true, name: true, brief: true, visualDirection: true },
  });

  if (!existing) {
    throw new Error("Project not found.");
  }

  const name = cleanText(input.name ?? existing.name, 120);
  if (!name) {
    throw new Error("Project name is required.");
  }

  const brief = cleanText(input.brief ?? existing.brief, 800) || null;
  const visualDirection = cleanText(input.visualDirection ?? existing.visualDirection, 800) || null;

  await prisma.project.update({
    where: { id: existing.id },
    data: {
      name,
      brief,
      visualDirection,
      searchText: buildSearchText(name, brief, visualDirection),
    },
    select: { id: true },
  });

  return getStudioProjectDetailForClerkUser(input.clerkUserId, existing.id);
}

export async function runStudioProjectCommand(input: {
  clerkUserId: string;
  projectId: string;
  content: string;
  assetId?: string | null;
  referenceImageDataUrl?: string | null;
  resultCount?: number;
}) {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, user: { clerkUserId: input.clerkUserId } },
    select: {
      id: true,
      name: true,
      brief: true,
      visualDirection: true,
      assets: {
        orderBy: { createdAt: "desc" },
        take: 4,
        select: {
          id: true,
          kind: true,
          title: true,
          sourceUrl: true,
          prompt: true,
          enhancedPrompt: true,
          mimeType: true,
          tags: true,
          createdAt: true,
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          role: true,
          content: true,
        },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found.");
  }

  const content = cleanText(input.content, 2000);
  if (!content) {
    throw new Error("A prompt or edit instruction is required.");
  }
  const referenceImageDataUrl = cleanDataUrl(input.referenceImageDataUrl);
  const resultCount = clampResultCount(input.resultCount);

  const referenceAsset = project.assets.find((asset) => asset.id === input.assetId) ?? project.assets[0] ?? null;
  const plan = await planStudioCommand({
    project,
    content,
    referenceAsset,
  });

  await prisma.projectMessage.create({
    data: {
      projectId: project.id,
      role: "user",
      content,
      commandType: plan.mode,
    },
    select: { id: true },
  });

  let assistantReply = plan.assistantReply;
  let createdAssetId: string | null = null;
  let createdAssetIds: string[] = [];
  let imageFailureMessage: string | null = null;

  try {
    if (plan.mode === "generate" || plan.mode === "edit") {
      const useReferenceImage = Boolean(referenceImageDataUrl || referenceAsset) && (
        plan.mode === "edit" ||
        /variation|variations|version|versions|remix/i.test(content) ||
        Boolean(referenceImageDataUrl)
      );
      const sourceUrl = referenceImageDataUrl || referenceAsset?.sourceUrl || null;
      const images = useReferenceImage && sourceUrl
        ? await editStudioImages({ prompt: plan.prompt, sourceUrl, count: resultCount })
        : await generateStudioImages(plan.prompt, resultCount);

      const createdAssets = await Promise.all(images.map((image, index) => prisma.projectAsset.create({
        data: {
          projectId: project.id,
          kind: "image",
          title: buildAssetTitle(plan.title, index, images.length),
          sourceUrl: image.dataUrl,
          prompt: content,
          enhancedPrompt: plan.prompt,
          mimeType: image.mimeType,
          tags: normalizeTags(plan.tags),
          searchText: buildSearchText(plan.title, content, plan.prompt, ...plan.tags),
          metadata: {
            mode: useReferenceImage ? "edit" : plan.mode,
            favorite: false,
            referenceAssetId: referenceAsset?.id || null,
            resultCount: images.length,
            resultIndex: index,
            usedReferenceUpload: Boolean(referenceImageDataUrl),
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      })));
      createdAssetIds = createdAssets.map((asset) => asset.id);
      createdAssetId = createdAssetIds[0] || null;
      assistantReply = createdAssetIds.length
        ? `${assistantReply} I added ${createdAssetIds.length} image ${createdAssetIds.length === 1 ? "version" : "versions"} to the library for saving, editing, and download.`
        : assistantReply;
    }
  } catch (error) {
    imageFailureMessage = error instanceof Error ? error.message : "Image processing failed.";
    assistantReply = `${assistantReply} Image processing failed: ${imageFailureMessage}`;
  }

  await prisma.projectMessage.create({
    data: {
      projectId: project.id,
      role: "assistant",
      content: assistantReply,
      commandType: plan.mode,
      metadata: createdAssetIds.length
        ? ({ assetId: createdAssetId, assetIds: createdAssetIds } as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
    select: { id: true },
  });

  await prisma.project.update({
    where: { id: project.id },
    data: {
      lastActivityAt: new Date(),
      searchText: buildSearchText(project.name, project.brief, project.visualDirection, content, plan.prompt, ...plan.tags),
    },
    select: { id: true },
  });

  if (imageFailureMessage) {
    throw new Error(imageFailureMessage);
  }

  return {
    project: await getStudioProjectDetailForClerkUser(input.clerkUserId, project.id),
    createdAssetId,
    createdAssetIds,
  };
}

export async function setStudioAssetFavoriteForClerkUser(input: {
  clerkUserId: string;
  assetId: string;
  favorite: boolean;
}) {
  const asset = await prisma.projectAsset.findFirst({
    where: {
      id: input.assetId,
      project: { user: { clerkUserId: input.clerkUserId } },
    },
    select: {
      id: true,
      metadata: true,
      projectId: true,
    },
  });

  if (!asset) {
    throw new Error("Asset not found.");
  }

  const metadata = asRecord(asset.metadata);
  await prisma.projectAsset.update({
    where: { id: asset.id },
    data: {
      metadata: {
        ...metadata,
        favorite: input.favorite,
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return {
    assetId: asset.id,
    favorite: input.favorite,
    project: await getStudioProjectDetailForClerkUser(input.clerkUserId, asset.projectId),
  };
}

function mapProjectSummary(project: {
  id: string;
  name: string;
  brief: string | null;
  visualDirection: string | null;
  updatedAt: Date;
  lastActivityAt: Date;
  _count: { assets: number; messages: number };
}): StudioProjectSummary {
  return {
    id: project.id,
    name: project.name,
    brief: project.brief,
    visualDirection: project.visualDirection,
    updatedAt: project.updatedAt.toISOString(),
    lastActivityAt: project.lastActivityAt.toISOString(),
    assetCount: project._count.assets,
    messageCount: project._count.messages,
  };
}

async function planStudioCommand(input: {
  project: {
    name: string;
    brief: string | null;
    visualDirection: string | null;
    messages: Array<{ role: string; content: string }>;
    assets: Array<{ title: string; prompt: string | null; enhancedPrompt: string | null; tags: string[] }>;
  };
  content: string;
  referenceAsset: { title: string; prompt: string | null; enhancedPrompt: string | null; tags: string[] } | null;
}): Promise<StudioCommandPlan> {
  const llmResult = await callLLMResult(
    [
      {
        role: "system",
        content: [
          "You are the creative operating system for an AI art studio.",
          "Classify the user's latest turn as generate, edit, or chat.",
          "Generate a polished production-ready prompt when the mode is generate or edit.",
          "For edit, preserve the core subject and composition unless the instruction explicitly changes them.",
          "Keep the assistantReply concise and practical.",
          "Return only JSON matching the provided schema.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          projectName: input.project.name,
          brief: input.project.brief,
          visualDirection: input.project.visualDirection,
          recentMessages: input.project.messages.slice(0, 6),
          recentAssets: input.project.assets.slice(0, 3),
          referenceAsset: input.referenceAsset,
          latestUserInstruction: input.content,
        }),
      },
    ],
    700,
    0.35,
    { guidedJson: studioCommandSchema }
  );

  if (llmResult.ok) {
    try {
      const parsed = JSON.parse(llmResult.content) as StudioCommandPlan;
      return {
        mode: parsed.mode,
        title: cleanText(parsed.title, 120) || fallbackTitle(input.content),
        assistantReply: cleanText(parsed.assistantReply, 280) || fallbackAssistantReply(parsed.mode),
        prompt: cleanText(parsed.prompt, 1600) || fallbackPrompt(input.content, parsed.mode, input.referenceAsset),
        tags: normalizeTags(parsed.tags),
      };
    } catch {
      // Fall through to heuristic handling.
    }
  }

  const mode = inferCommandMode(input.content, Boolean(input.referenceAsset));
  return {
    mode,
    title: fallbackTitle(input.content),
    assistantReply: fallbackAssistantReply(mode),
    prompt: fallbackPrompt(input.content, mode, input.referenceAsset),
    tags: normalizeTags(input.content.split(/[^a-zA-Z0-9]+/g).filter(Boolean).slice(0, 6)),
  };
}

function inferCommandMode(content: string, hasReferenceAsset: boolean) {
  const lowered = content.toLowerCase();
  if (hasReferenceAsset && /(make|remove|add|change|replace|edit|swap|turn|recolor|crop)/.test(lowered)) {
    return "edit" as const;
  }
  if (/(generate|create|render|make|design|concept|illustrate|compose)/.test(lowered)) {
    return "generate" as const;
  }
  return hasReferenceAsset ? "edit" as const : "chat" as const;
}

function fallbackTitle(content: string) {
  const cleaned = cleanText(content, 120);
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned || "Studio asset";
}

function fallbackAssistantReply(mode: "generate" | "edit" | "chat") {
  if (mode === "edit") return "I translated that into a derivative edit instruction and queued a revised version.";
  if (mode === "generate") return "I expanded that into a production-ready image prompt and generated a new draft.";
  return "I logged that direction into the project conversation so the project history stays searchable.";
}

function fallbackPrompt(
  content: string,
  mode: "generate" | "edit" | "chat",
  referenceAsset: { title: string; prompt: string | null; enhancedPrompt: string | null; tags: string[] } | null
) {
  if (mode === "chat") return content;
  if (mode === "edit") {
    return [
      "Apply this art-direction edit to the reference image while preserving the main subject, camera framing, and overall composition unless explicitly changed.",
      `Reference asset: ${referenceAsset?.title || "latest asset"}`,
      `Reference prompt: ${referenceAsset?.enhancedPrompt || referenceAsset?.prompt || "none recorded"}`,
      `Requested change: ${content}`,
      "Keep the output polished, commercially usable, and visually coherent.",
    ].join("\n");
  }

  return [
    "Create a polished, campaign-ready visual asset.",
    `User request: ${content}`,
    "Favor strong composition, intentional color, premium art direction, and production-quality detail.",
  ].join("\n");
}

async function generateStudioImages(prompt: string, count: number) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  return Promise.all(Array.from({ length: count }, async () => {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        size: "1024x1024",
        prompt,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const apiMessage = String((data as { error?: { message?: unknown } } | null)?.error?.message || "").trim();
      throw new Error(apiMessage || "Image generation request failed.");
    }

    const image = Array.isArray((data as { data?: Array<{ b64_json?: string; url?: string }> } | null)?.data)
      ? (data as { data: Array<{ b64_json?: string; url?: string }> }).data[0]
      : null;

    return normalizeImagePayload(image);
  }));
}

async function editStudioImages(input: { prompt: string; sourceUrl: string; count: number }) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const imageBlob = await sourceUrlToBlob(input.sourceUrl);

  return Promise.all(Array.from({ length: input.count }, async () => {
    const formData = new FormData();
    formData.append("model", model);
    formData.append("size", "1024x1024");
    formData.append("prompt", input.prompt);
    formData.append("image", imageBlob, "reference.png");

    const response = await fetch(`${baseUrl}/images/edits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const apiMessage = String((data as { error?: { message?: unknown } } | null)?.error?.message || "").trim();
      throw new Error(apiMessage || "Image edit request failed.");
    }

    const image = Array.isArray((data as { data?: Array<{ b64_json?: string; url?: string }> } | null)?.data)
      ? (data as { data: Array<{ b64_json?: string; url?: string }> }).data[0]
      : null;

    return normalizeImagePayload(image);
  }));
}

async function normalizeImagePayload(image: { b64_json?: string; url?: string } | null | undefined) {
  if (image?.b64_json) {
    return { dataUrl: `data:image/png;base64,${image.b64_json}`, mimeType: "image/png" };
  }

  if (image?.url) {
    const response = await fetch(image.url);
    if (!response.ok) throw new Error("Generated image could not be downloaded.");
    const mimeType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
      mimeType,
    };
  }

  throw new Error("Image generation returned no image payload.");
}

async function sourceUrlToBlob(sourceUrl: string) {
  if (sourceUrl.startsWith("data:")) {
    const match = sourceUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid asset data URL.");
    const [, mimeType, encoded] = match;
    return new Blob([Buffer.from(encoded, "base64")], { type: mimeType });
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error("Reference asset could not be loaded for editing.");
  }

  return new Blob([Buffer.from(await response.arrayBuffer())], {
    type: response.headers.get("content-type") || "image/png",
  });
}

function cleanText(value: unknown, maxLength = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeTags(tags: unknown) {
  const values = Array.isArray(tags) ? tags : [];
  return Array.from(new Set(values.map((item) => cleanText(item, 24).toLowerCase()).filter(Boolean))).slice(0, 6);
}

function buildSearchText(...parts: Array<string | null | undefined>) {
  return cleanText(parts.filter(Boolean).join(" "), 4000) || null;
}

function buildAssetTitle(title: string, index: number, total: number) {
  const cleaned = cleanText(title, 110) || "Studio image";
  return total > 1 ? `${cleaned} ${index + 1}` : cleaned;
}

function clampResultCount(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(4, Math.floor(numeric)));
}

function cleanDataUrl(value: unknown) {
  const cleaned = String(value || "").trim();
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(cleaned) ? cleaned : null;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readAssetMetadataFlag(value: unknown, key: string) {
  return Boolean(asRecord(value)[key]);
}

function readAssetMetadataString(value: unknown, key: string) {
  const candidate = asRecord(value)[key];
  return typeof candidate === "string" ? candidate : null;
}