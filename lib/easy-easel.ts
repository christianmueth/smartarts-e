import { Prisma } from "@prisma/client";
import { prisma, safeUpsertUser } from "@/lib/db";
import type {
  EditorAsset,
  EditorAssetType,
  EditorCanvasDocument,
  EditorProjectDetail,
  EditorProjectSummary,
} from "@/types/easy-easel";
import { createEmptyEditorDocument } from "@/types/easy-easel";

const EDITOR_LIBRARY_PROJECT_STATUS = "asset-library";
const EDITOR_LIBRARY_PROJECT_NAME = "Easy Easel Library";

export async function listEditorProjectsForClerkUser(clerkUserId: string): Promise<EditorProjectSummary[]> {
  const user = await safeUpsertUser(clerkUserId, { id: true });
  if (!user) {
    throw new Error("User persistence is unavailable right now.");
  }

  const projects = await prisma.editorProject.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 24,
    select: {
      id: true,
      name: true,
      previewUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    previewUrl: project.previewUrl,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }));
}

export async function createEditorProjectForClerkUser(input: {
  clerkUserId: string;
  name: string;
  canvas?: EditorCanvasDocument | null;
  previewUrl?: string | null;
}) {
  const user = await safeUpsertUser(input.clerkUserId, { id: true });
  if (!user) {
    throw new Error("User persistence is unavailable right now.");
  }

  const name = cleanText(input.name, 120) || "Untitled project";
  const canvas = normalizeEditorCanvas(input.canvas);
  const previewUrl = cleanNullableUrl(input.previewUrl);

  const project = await prisma.editorProject.create({
    data: {
      userId: user.id,
      name,
      canvasJson: canvas as Prisma.InputJsonValue,
      previewUrl,
    },
    select: {
      id: true,
      name: true,
      previewUrl: true,
      canvasJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return mapEditorProject(project);
}

export async function getEditorProjectForClerkUser(clerkUserId: string, projectId: string): Promise<EditorProjectDetail | null> {
  const project = await prisma.editorProject.findFirst({
    where: {
      id: projectId,
      user: { clerkUserId },
    },
    select: {
      id: true,
      name: true,
      previewUrl: true,
      canvasJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return project ? mapEditorProject(project) : null;
}

export async function saveEditorProjectForClerkUser(input: {
  clerkUserId: string;
  projectId: string;
  name?: string | null;
  canvas: EditorCanvasDocument;
  previewUrl?: string | null;
}) {
  const existing = await prisma.editorProject.findFirst({
    where: {
      id: input.projectId,
      user: { clerkUserId: input.clerkUserId },
    },
    select: { id: true, name: true },
  });

  if (!existing) {
    throw new Error("Project not found.");
  }

  const project = await prisma.editorProject.update({
    where: { id: existing.id },
    data: {
      name: cleanText(input.name ?? existing.name, 120) || existing.name,
      canvasJson: normalizeEditorCanvas(input.canvas) as Prisma.InputJsonValue,
      previewUrl: cleanNullableUrl(input.previewUrl),
    },
    select: {
      id: true,
      name: true,
      previewUrl: true,
      canvasJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return mapEditorProject(project);
}

export async function listEditorAssetsForClerkUser(clerkUserId: string): Promise<EditorAsset[]> {
  const assets = await prisma.projectAsset.findMany({
    where: {
      kind: "image",
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
      prompt: true,
      width: true,
      height: true,
      metadata: true,
      createdAt: true,
    },
  });

  return assets.map(mapEditorAsset);
}

export async function getEditorAssetForClerkUser(clerkUserId: string, assetId: string) {
  const asset = await prisma.projectAsset.findFirst({
    where: {
      id: assetId,
      kind: "image",
      project: {
        user: { clerkUserId },
      },
    },
    select: {
      id: true,
      title: true,
      sourceUrl: true,
      prompt: true,
      width: true,
      height: true,
      metadata: true,
      createdAt: true,
    },
  });

  return asset ? mapEditorAsset(asset) : null;
}

export async function createUploadedEditorAssetForClerkUser(input: {
  clerkUserId: string;
  title: string;
  imageUrl: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  saved?: boolean;
}) {
  return createEditorAssetRecordForClerkUser({
    clerkUserId: input.clerkUserId,
    title: input.title,
    imageUrl: input.imageUrl,
    mimeType: input.mimeType || null,
    assetType: "upload",
    width: input.width ?? null,
    height: input.height ?? null,
    prompt: null,
    sourceAssetId: null,
    saved: input.saved,
  });
}

export async function saveEditorSnapshotAssetForClerkUser(input: {
  clerkUserId: string;
  title: string;
  imageUrl: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
}) {
  return createEditorAssetRecordForClerkUser({
    clerkUserId: input.clerkUserId,
    title: input.title,
    imageUrl: input.imageUrl,
    mimeType: input.mimeType || "image/png",
    assetType: "edited",
    width: input.width ?? null,
    height: input.height ?? null,
    prompt: "Easy Easel canvas snapshot",
    sourceAssetId: null,
    saved: true,
  });
}

export async function generateEditorAssetsForClerkUser(input: {
  clerkUserId: string;
  prompt: string;
  count?: number;
}) {
  const prompt = cleanText(input.prompt, 1600);
  if (!prompt) {
    throw new Error("A prompt is required.");
  }

  const count = clampResultCount(input.count);
  const images = await generateImages(prompt, count);

  return Promise.all(images.map((image, index) => createEditorAssetRecordForClerkUser({
    clerkUserId: input.clerkUserId,
    title: buildAssetTitle(prompt, index, images.length),
    imageUrl: image.dataUrl,
    mimeType: image.mimeType,
    assetType: "generated",
    width: 1024,
    height: 1024,
    prompt,
    sourceAssetId: null,
  })));
}

export async function editEditorAssetForClerkUser(input: {
  clerkUserId: string;
  assetId: string;
  prompt: string;
  count?: number;
}) {
  const sourceAsset = await prisma.projectAsset.findFirst({
    where: {
      id: input.assetId,
      kind: "image",
      project: {
        user: { clerkUserId: input.clerkUserId },
      },
    },
    select: {
      id: true,
      title: true,
      sourceUrl: true,
    },
  });

  if (!sourceAsset) {
    throw new Error("Source image not found.");
  }

  const prompt = cleanText(input.prompt, 1600);
  if (!prompt) {
    throw new Error("An edit instruction is required.");
  }

  const count = clampResultCount(input.count);
  const images = await editImages({
    prompt,
    sourceUrl: sourceAsset.sourceUrl,
    count,
  });

  return Promise.all(images.map((image, index) => createEditorAssetRecordForClerkUser({
    clerkUserId: input.clerkUserId,
    title: buildAssetTitle(`${sourceAsset.title} edit`, index, images.length),
    imageUrl: image.dataUrl,
    mimeType: image.mimeType,
    assetType: "edited",
    width: 1024,
    height: 1024,
    prompt,
    sourceAssetId: sourceAsset.id,
  })));
}

async function createEditorAssetRecordForClerkUser(input: {
  clerkUserId: string;
  title: string;
  imageUrl: string;
  mimeType: string | null;
  assetType: EditorAssetType;
  width: number | null;
  height: number | null;
  prompt: string | null;
  sourceAssetId: string | null;
  saved?: boolean;
}) {
  const libraryProjectId = await ensureEditorLibraryProjectId(input.clerkUserId);

  const asset = await prisma.projectAsset.create({
    data: {
      projectId: libraryProjectId,
      kind: "image",
      title: cleanText(input.title, 120) || "Easy Easel image",
      sourceUrl: input.imageUrl,
      prompt: input.prompt,
      enhancedPrompt: input.prompt,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      tags: [],
      searchText: buildSearchText(input.title, input.prompt, input.assetType),
      metadata: {
        assetType: input.assetType,
        editorVisible: true,
        saved: Boolean(input.saved),
        sourceAssetId: input.sourceAssetId,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      title: true,
      sourceUrl: true,
      prompt: true,
      width: true,
      height: true,
      metadata: true,
      createdAt: true,
    },
  });

  return mapEditorAsset(asset);
}

async function ensureEditorLibraryProjectId(clerkUserId: string) {
  const user = await safeUpsertUser(clerkUserId, { id: true });
  if (!user) {
    throw new Error("User persistence is unavailable right now.");
  }

  const existing = await prisma.project.findFirst({
    where: {
      userId: user.id,
      status: EDITOR_LIBRARY_PROJECT_STATUS,
    },
    select: { id: true },
  });

  if (existing) {
    return existing.id;
  }

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: EDITOR_LIBRARY_PROJECT_NAME,
      brief: "System project for Easy Easel assets.",
      status: EDITOR_LIBRARY_PROJECT_STATUS,
      lastActivityAt: new Date(),
      searchText: buildSearchText(EDITOR_LIBRARY_PROJECT_NAME),
    },
    select: { id: true },
  });

  return project.id;
}

function mapEditorProject(project: {
  id: string;
  name: string;
  previewUrl: string | null;
  canvasJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}): EditorProjectDetail {
  return {
    id: project.id,
    name: project.name,
    previewUrl: project.previewUrl,
    canvas: normalizeEditorCanvas(project.canvasJson),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function mapEditorAsset(asset: {
  id: string;
  title: string;
  sourceUrl: string;
  prompt: string | null;
  width: number | null;
  height: number | null;
  metadata: unknown;
  createdAt: Date;
}): EditorAsset {
  const metadata = asRecord(asset.metadata);
  const type = readEditorAssetType(metadata, asset.prompt, metadata.sourceAssetId);

  return {
    id: asset.id,
    title: asset.title,
    imageUrl: asset.sourceUrl,
    type,
    isSaved: metadata.saved === true,
    sourceAssetId: typeof metadata.sourceAssetId === "string" ? metadata.sourceAssetId : null,
    prompt: asset.prompt,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt.toISOString(),
  };
}

function normalizeEditorCanvas(value: unknown): EditorCanvasDocument {
  const base = createEmptyEditorDocument();
  const record = asRecord(value);
  const width = clampDimension(record.width, base.width);
  const height = clampDimension(record.height, base.height);
  const backgroundColor = typeof record.backgroundColor === "string" && record.backgroundColor.trim()
    ? record.backgroundColor.trim()
    : base.backgroundColor;
  const layers = Array.isArray(record.layers)
    ? record.layers.map(normalizeLayer).filter(Boolean) as EditorCanvasDocument["layers"]
    : base.layers;

  return {
    width,
    height,
    backgroundColor,
    layers,
  };
}

function normalizeLayer(value: unknown) {
  const record = asRecord(value);
  const kind = typeof record.kind === "string" ? record.kind : "";
  const base = {
    id: cleanText(record.id, 80) || `layer-${Date.now()}`,
    name: cleanText(record.name, 120) || "Layer",
    x: asNumber(record.x),
    y: asNumber(record.y),
    width: clampDimension(record.width, 200),
    height: clampDimension(record.height, 200),
    rotation: asNumber(record.rotation),
    opacity: clampOpacity(record.opacity),
  };

  if (kind === "image") {
    const src = cleanText(record.src, 4000);
    if (!src) return null;
    return {
      ...base,
      kind: "image" as const,
      assetId: typeof record.assetId === "string" ? record.assetId : null,
      src,
      brightness: clampFilter(record.brightness),
      contrast: clampFilter(record.contrast),
    };
  }

  if (kind === "text") {
    return {
      ...base,
      kind: "text" as const,
      text: cleanText(record.text, 2000) || "Text",
      fill: cleanColor(record.fill, "#2d1023"),
      fontSize: Math.max(10, Math.min(240, Math.round(asNumber(record.fontSize) || 42))),
      fontFamily: cleanText(record.fontFamily, 80) || "Manrope",
    };
  }

  if (kind === "rect" || kind === "ellipse") {
    return {
      ...base,
      kind,
      fill: cleanColor(record.fill, "#ffd6e9"),
      stroke: cleanColor(record.stroke, "#ff5fb2"),
      strokeWidth: Math.max(1, Math.min(24, Math.round(asNumber(record.strokeWidth) || 4))),
    };
  }

  if (kind === "line") {
    const points = Array.isArray(record.points)
      ? record.points.map((point) => asNumber(point)).filter((point) => Number.isFinite(point))
      : [];
    if (points.length < 4) return null;
    return {
      ...base,
      kind: "line" as const,
      points,
      stroke: cleanColor(record.stroke, "#2d1023"),
      strokeWidth: Math.max(1, Math.min(64, Math.round(asNumber(record.strokeWidth) || 8))),
      compositeMode: record.compositeMode === "destination-out" ? "destination-out" : "source-over",
    };
  }

  return null;
}

async function generateImages(prompt: string, count: number) {
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

async function editImages(input: { prompt: string; sourceUrl: string; count: number }) {
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

function readEditorAssetType(metadata: Record<string, unknown>, prompt: string | null, sourceAssetId: unknown): EditorAssetType {
  if (metadata.assetType === "upload" || metadata.assetType === "generated" || metadata.assetType === "edited") {
    return metadata.assetType;
  }
  if (typeof sourceAssetId === "string" && sourceAssetId) {
    return "edited";
  }
  if (prompt) {
    return "generated";
  }
  return "upload";
}

function buildAssetTitle(prompt: string, index: number, total: number) {
  const cleaned = cleanText(prompt, 90) || "Easy Easel image";
  return total > 1 ? `${cleaned} ${index + 1}` : cleaned;
}

function cleanText(value: unknown, maxLength = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanNullableUrl(value: unknown) {
  const cleaned = String(value || "").trim();
  return cleaned ? cleaned.slice(0, 4_000_000) : null;
}

function buildSearchText(...parts: Array<string | null | undefined>) {
  return cleanText(parts.filter(Boolean).join(" "), 4000) || null;
}

function clampResultCount(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(4, Math.floor(numeric)));
}

function clampDimension(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(24, Math.min(6000, Math.round(numeric)));
}

function clampOpacity(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0.05, Math.min(1, numeric));
}

function clampFilter(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-1, Math.min(1, numeric));
}

function cleanColor(value: unknown, fallback: string) {
  const cleaned = String(value || "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(cleaned) ? cleaned : fallback;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
