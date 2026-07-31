"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text as KonvaText, Transformer } from "react-konva";
import { toast } from "sonner";
import type {
  EditorAssistAction,
  EditorAssistPlan,
  EditorAssistSelectedLayer,
  EditorAsset,
  EditorCanvasDocument,
  EditorCropRect,
  EditorImageLayer,
  EditorLayer,
  EditorProjectDetail,
  EditorProjectSummary,
} from "@/types/easy-easel";
import { createEmptyEditorDocument } from "@/types/easy-easel";

type Tool = "select" | "brush" | "eraser" | "rect" | "ellipse" | "text" | "crop";

type Props = {
  initialAssets: EditorAsset[];
  initialProjects: EditorProjectSummary[];
  initialProject: EditorProjectDetail | null;
};

export default function EasyEaselEditor({ initialAssets, initialProjects, initialProject }: Props) {
  const [assets, setAssets] = useState(initialAssets);
  const [projects, setProjects] = useState(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initialProject?.id || null);
  const [projectName, setProjectName] = useState(initialProject?.name || "Untitled project");
  const [document, setDocument] = useState<EditorCanvasDocument>(initialProject?.canvas || createEmptyEditorDocument());
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(getTopLayerId(initialProject?.canvas || createEmptyEditorDocument()));
  const [tool, setTool] = useState<Tool>("select");
  const [strokeColor, setStrokeColor] = useState("#ff5fb2");
  const [fillColor, setFillColor] = useState("#ffe09c");
  const [brushSize, setBrushSize] = useState(8);
  const [zoom, setZoom] = useState(0.72);
  const [aiPrompt, setAiPrompt] = useState("");
  const [busyAction, setBusyAction] = useState<null | "upload" | "save" | "save-library" | "generate" | "edit" | "variation" | "export-png" | "export-jpeg">(null);
  const [cropRect, setCropRect] = useState<EditorCropRect | null>(null);
  const [assistantCursor, setAssistantCursor] = useState<{ x: number; y: number; label: string } | null>(null);
  const [historyState, setHistoryState] = useState(() => ({
    snapshots: [serializeDocument(initialProject?.canvas || createEmptyEditorDocument())],
    index: 0,
  }));

  const documentRef = useRef(document);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef<Record<string, Konva.Group | null>>({});
  const isDrawingRef = useRef(false);
  const cropAnchorRef = useRef<{ x: number; y: number } | null>(null);

  const selectedLayer = useMemo(
    () => document.layers.find((layer) => layer.id === selectedLayerId) ?? null,
    [document.layers, selectedLayerId]
  );
  const selectedImageLayer = selectedLayer?.kind === "image" ? selectedLayer as EditorImageLayer : null;

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const selectedNode = selectedLayerId ? nodeRefs.current[selectedLayerId] : null;
    if (!transformer) return;
    if (selectedNode && selectedLayer?.kind !== "line") {
      transformer.nodes([selectedNode]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [selectedLayerId, selectedLayer, document.layers]);

  function commitDocument(nextDocument: EditorCanvasDocument, nextSelectedLayerId?: string | null) {
    documentRef.current = nextDocument;
    setDocument(nextDocument);
    setSelectedLayerId(resolveSelectedLayerId(nextDocument, nextSelectedLayerId ?? selectedLayerId));
    setHistoryState((current) => {
      const snapshot = serializeDocument(nextDocument);
      const trimmed = current.snapshots.slice(0, current.index + 1);
      if (trimmed[trimmed.length - 1] === snapshot) {
        return current;
      }
      const nextSnapshots = [...trimmed, snapshot].slice(-80);
      return {
        snapshots: nextSnapshots,
        index: nextSnapshots.length - 1,
      };
    });
  }

  function resetDocument(nextDocument: EditorCanvasDocument, options?: { selectedLayerId?: string | null }) {
    documentRef.current = nextDocument;
    setDocument(nextDocument);
    setSelectedLayerId(resolveSelectedLayerId(nextDocument, options?.selectedLayerId ?? getTopLayerId(nextDocument)));
    setHistoryState({
      snapshots: [serializeDocument(nextDocument)],
      index: 0,
    });
    setCropRect(null);
  }

  function mutateDocument(mutator: (current: EditorCanvasDocument) => EditorCanvasDocument, nextSelectedLayerId?: string | null) {
    const nextDocument = mutator(documentRef.current);
    commitDocument(nextDocument, nextSelectedLayerId);
  }

  function setLiveDocument(mutator: (current: EditorCanvasDocument) => EditorCanvasDocument) {
    const nextDocument = mutator(documentRef.current);
    documentRef.current = nextDocument;
    setDocument(nextDocument);
  }

  function undo() {
    setHistoryState((current) => {
      if (current.index === 0) return current;
      const nextIndex = current.index - 1;
      const nextDocument = deserializeDocument(current.snapshots[nextIndex]);
      documentRef.current = nextDocument;
      setDocument(nextDocument);
      setSelectedLayerId((previous) => resolveSelectedLayerId(nextDocument, previous));
      setCropRect(null);
      return { ...current, index: nextIndex };
    });
  }

  function redo() {
    setHistoryState((current) => {
      if (current.index >= current.snapshots.length - 1) return current;
      const nextIndex = current.index + 1;
      const nextDocument = deserializeDocument(current.snapshots[nextIndex]);
      documentRef.current = nextDocument;
      setDocument(nextDocument);
      setSelectedLayerId((previous) => resolveSelectedLayerId(nextDocument, previous));
      setCropRect(null);
      return { ...current, index: nextIndex };
    });
  }

  function addShape(kind: "rect" | "ellipse") {
    const id = createId(kind);
    const layer: EditorLayer = {
      id,
      kind,
      name: kind === "rect" ? "Rectangle" : "Ellipse",
      x: 120 + document.layers.length * 8,
      y: 120 + document.layers.length * 8,
      width: 220,
      height: 140,
      rotation: 0,
      opacity: 1,
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: 4,
    };
    mutateDocument((current) => ({
      ...current,
      layers: [...current.layers, layer],
    }), id);
    setTool("select");
  }

  function addTextLayer() {
    const id = createId("text");
    const layer: EditorLayer = {
      id,
      kind: "text",
      name: "Text",
      x: 140,
      y: 140,
      width: 360,
      height: 80,
      rotation: 0,
      opacity: 1,
      text: "Double-click to edit",
      fill: strokeColor,
      fontSize: 42,
      fontFamily: "Manrope",
    };
    mutateDocument((current) => ({
      ...current,
      layers: [...current.layers, layer],
    }), id);
    setTool("select");
  }

  function duplicateSelectedLayer() {
    if (!selectedLayer) return;
    const duplicate = JSON.parse(JSON.stringify(selectedLayer)) as EditorLayer;
    duplicate.id = createId(selectedLayer.kind);
    duplicate.name = `${selectedLayer.name} copy`;
    duplicate.x += 24;
    duplicate.y += 24;
    mutateDocument((current) => ({
      ...current,
      layers: [...current.layers, duplicate],
    }), duplicate.id);
  }

  function deleteSelectedLayer() {
    if (!selectedLayer) return;
    mutateDocument((current) => ({
      ...current,
      layers: current.layers.filter((layer) => layer.id !== selectedLayer.id),
    }), null);
  }

  function moveLayer(layerId: string, direction: "up" | "down") {
    mutateDocument((current) => {
      const index = current.layers.findIndex((layer) => layer.id === layerId);
      if (index === -1) return current;
      const targetIndex = direction === "up" ? Math.min(current.layers.length - 1, index + 1) : Math.max(0, index - 1);
      if (targetIndex === index) return current;
      const layers = [...current.layers];
      const [layer] = layers.splice(index, 1);
      layers.splice(targetIndex, 0, layer);
      return { ...current, layers };
    }, layerId);
  }

  function updateLayer(layerId: string, updater: (layer: EditorLayer) => EditorLayer) {
    mutateDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === layerId ? updater(layer) : layer),
    }), layerId);
  }

  function insertAssetAsLayer(asset: EditorAsset) {
    const naturalWidth = asset.width || 1024;
    const naturalHeight = asset.height || 1024;
    const fitWidth = Math.min(420, naturalWidth);
    const fitHeight = Math.max(120, Math.round(naturalHeight * (fitWidth / naturalWidth)));
    const id = createId("image");
    const imageLayer: EditorImageLayer = {
      id,
      kind: "image",
      name: asset.title || "Image",
      x: Math.max(40, (document.width - fitWidth) / 2),
      y: Math.max(40, (document.height - fitHeight) / 2),
      width: fitWidth,
      height: fitHeight,
      rotation: 0,
      opacity: 1,
      assetId: asset.id,
      src: asset.imageUrl,
      brightness: 0,
      contrast: 0,
    };
    mutateDocument((current) => ({
      ...current,
      layers: [...current.layers, imageLayer],
    }), id);
  }

  function setLayerPosition(layerId: string, x: number, y: number) {
    updateLayer(layerId, (layer) => ({ ...layer, x, y }));
  }

  function handleTransformEnd(layerId: string) {
    const node = nodeRefs.current[layerId];
    if (!node) return;

    updateLayer(layerId, (layer) => {
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      return {
        ...layer,
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        width: Math.max(24, Math.round(layer.width * scaleX)),
        height: Math.max(24, Math.round(layer.height * scaleY)),
      };
    });
  }

  function handleTextEdit(layerId: string) {
    const layer = document.layers.find((item) => item.id === layerId);
    if (!layer || layer.kind !== "text") return;
    const nextText = window.prompt("Edit text", layer.text);
    if (nextText === null) return;
    updateLayer(layerId, (current) => current.kind === "text"
      ? { ...current, text: nextText || "Text" }
      : current);
  }

  function handleBackgroundColorChange(value: string) {
    mutateDocument((current) => ({ ...current, backgroundColor: value }));
  }

  function handleStageMouseDown() {
    const point = getCanvasPointer(stageRef.current, zoom);
    if (!point) return;

    if (tool === "brush" || tool === "eraser") {
      const id = createId("line");
      const nextLine: EditorLayer = {
        id,
        kind: "line",
        name: tool === "brush" ? "Brush stroke" : "Eraser stroke",
        x: 0,
        y: 0,
        width: document.width,
        height: document.height,
        rotation: 0,
        opacity: 1,
        points: [point.x, point.y],
        stroke: tool === "brush" ? strokeColor : "#ffffff",
        strokeWidth: brushSize,
        compositeMode: tool === "eraser" ? "destination-out" : "source-over",
      };
      isDrawingRef.current = true;
      const nextDocument = {
        ...documentRef.current,
        layers: [...documentRef.current.layers, nextLine],
      };
      documentRef.current = nextDocument;
      setDocument(nextDocument);
      setSelectedLayerId(id);
      return;
    }

    if (tool === "crop") {
      cropAnchorRef.current = point;
      setCropRect({ x: point.x, y: point.y, width: 1, height: 1 });
      return;
    }
  }

  function handleStageMouseMove() {
    const point = getCanvasPointer(stageRef.current, zoom);
    if (!point) return;

    if (isDrawingRef.current) {
      setLiveDocument((current) => {
        const layers = [...current.layers];
        const lastLayer = layers[layers.length - 1];
        if (!lastLayer || lastLayer.kind !== "line") return current;
        layers[layers.length - 1] = {
          ...lastLayer,
          points: [...lastLayer.points, point.x, point.y],
        };
        return { ...current, layers };
      });
      return;
    }

    if (tool === "crop" && cropAnchorRef.current) {
      const { x, y } = cropAnchorRef.current;
      setCropRect(normalizeCropRect(x, y, point.x, point.y));
    }
  }

  function handleStageMouseUp() {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      commitDocument(documentRef.current, selectedLayerId);
      return;
    }
    if (tool === "crop") {
      cropAnchorRef.current = null;
    }
  }

  function applyCrop() {
    if (!cropRect) {
      toast.error("Draw a crop box first.");
      return;
    }

    const normalized = normalizeCropRect(cropRect.x, cropRect.y, cropRect.x + cropRect.width, cropRect.y + cropRect.height);
    mutateDocument((current) => ({
      ...current,
      width: Math.max(40, Math.round(normalized.width)),
      height: Math.max(40, Math.round(normalized.height)),
      layers: current.layers.map((layer) => {
        if (layer.kind === "line") {
          return {
            ...layer,
            width: Math.max(40, Math.round(normalized.width)),
            height: Math.max(40, Math.round(normalized.height)),
            points: shiftPoints(layer.points, normalized.x, normalized.y),
          };
        }
        return {
          ...layer,
          x: layer.x - normalized.x,
          y: layer.y - normalized.y,
        };
      }),
    }));
    setCropRect(null);
    setTool("select");
  }

  async function uploadImage(file: File | null) {
    if (!file) return;
    const toastId = toast.loading("Uploading image...");
    setBusyAction("upload");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.asset) {
        throw new Error(data?.error || "Image upload failed.");
      }
      const asset = data.asset as EditorAsset;
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      insertAssetAsLayer(asset);
      toast.success("Image uploaded.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  function buildSelectedLayerForAssist(): EditorAssistSelectedLayer | null {
    if (!selectedLayer) return null;
    return {
      id: selectedLayer.id,
      kind: selectedLayer.kind,
      name: selectedLayer.name,
      x: selectedLayer.x,
      y: selectedLayer.y,
      width: selectedLayer.width,
      height: selectedLayer.height,
    };
  }

  function buildAssistLayerCandidates(): EditorAssistSelectedLayer[] {
    return [...documentRef.current.layers]
      .reverse()
      .map((layer) => ({
        id: layer.id,
        kind: layer.kind,
        name: layer.name,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
      }));
  }

  function insertGeneratedAssets(nextAssets: EditorAsset[]) {
    setAssets((current) => [...nextAssets, ...current.filter((asset) => !nextAssets.some((item) => item.id === asset.id))]);
    nextAssets.forEach((asset, index) => {
      const naturalWidth = asset.width || 1024;
      const naturalHeight = asset.height || 1024;
      const width = Math.min(420, naturalWidth);
      const height = Math.max(120, Math.round(naturalHeight * (width / naturalWidth)));
      const imageLayer: EditorImageLayer = {
        id: createId("image"),
        kind: "image",
        name: asset.title || "AI image",
        x: 80 + index * 30,
        y: 80 + index * 30,
        width,
        height,
        rotation: 0,
        opacity: 1,
        assetId: asset.id,
        src: asset.imageUrl,
        brightness: 0,
        contrast: 0,
      };
      documentRef.current = {
        ...documentRef.current,
        layers: [...documentRef.current.layers, imageLayer],
      };
    });
    commitDocument(documentRef.current, getTopLayerId(documentRef.current));
  }

  async function requestEaselAssistPlan(prompt: string) {
    const response = await fetch("/api/easel/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        document: {
          width: documentRef.current.width,
          height: documentRef.current.height,
          backgroundColor: documentRef.current.backgroundColor,
          layerCount: documentRef.current.layers.length,
        },
        layers: buildAssistLayerCandidates(),
        selectedLayer: buildSelectedLayerForAssist(),
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !data?.plan) {
      throw new Error(data?.error || "Easel assist failed.");
    }
    return data.plan as EditorAssistPlan;
  }

  async function animateAssistantCursor(action: EditorAssistAction) {
    const points = cursorWaypointsForAction(action);
    if (!points.length) return;

    for (const point of points) {
      setAssistantCursor({
        x: point.x,
        y: point.y,
        label: action.label || action.tool,
      });
      await wait(action.tool === "text" ? 170 : 120);
    }
  }

  async function replayAssistActions(actions: EditorAssistAction[]) {
    const previousTool = tool;
    let workingDocument = documentRef.current;
    let lastLayerId = getTopLayerId(workingDocument);

    for (const action of actions) {
      setTool(action.tool === "brush" || action.tool === "eraser" || action.tool === "rect" || action.tool === "text"
        ? action.tool
        : action.tool === "ellipse"
          ? "ellipse"
        : "select");
      await animateAssistantCursor(action);

      const layer = buildLayerFromAssistAction(action, workingDocument);
      if (!layer) continue;

      workingDocument = {
        ...workingDocument,
        layers: [...workingDocument.layers, layer],
      };
      documentRef.current = workingDocument;
      setDocument(workingDocument);
      setSelectedLayerId(layer.id);
      lastLayerId = layer.id;
      await wait(140);
    }

    setAssistantCursor(null);
    setTool(previousTool);
    commitDocument(workingDocument, lastLayerId);
  }

  async function runAi(kind: "generate" | "edit" | "variation") {
    const trimmedPrompt = aiPrompt.trim();
    if (!trimmedPrompt) {
      toast.error("Describe the change you want.");
      return;
    }

    if ((kind === "edit" || kind === "variation") && !selectedImageLayer?.src) {
      toast.error("Select an image layer first.");
      return;
    }

    const toastId = toast.loading(kind === "generate"
      ? "Planning easel action..."
      : kind === "variation"
        ? "Creating variations..."
        : "Applying AI edit...");
    setBusyAction(kind);
    try {
      if (kind === "generate") {
        const plan = await requestEaselAssistPlan(trimmedPrompt);
        await replayAssistActions(plan.actions);
        setAiPrompt("");
        toast.success(plan.assistantMessage || "Applied easel tools.", { id: toastId });
        return;
      }

      const response = await fetch("/api/images/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: selectedImageLayer?.assetId,
          sourceUrl: selectedImageLayer?.src,
          sourceTitle: selectedImageLayer?.name,
          prompt: kind === "variation"
            ? `${trimmedPrompt}. Create 4 variations and keep the original subject readable.`
            : trimmedPrompt,
          count: kind === "variation" ? 4 : 1,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !Array.isArray(data?.assets)) {
        throw new Error(data?.error || "AI editing failed.");
      }

      const nextAssets = data.assets as EditorAsset[];
      insertGeneratedAssets(nextAssets);
      setAiPrompt("");
      toast.success(kind === "generate"
        ? "Image added as a new layer."
        : kind === "variation"
          ? "Variations added as new layers."
          : "Edited image added as a new layer.", { id: toastId });
    } catch (error) {
      setAssistantCursor(null);
      toast.error(error instanceof Error ? error.message : "AI request failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  async function saveProject() {
    const previewUrl = getStageDataUrl(stageRef.current, "image/png", zoom);
    const toastId = toast.loading("Saving project...");
    setBusyAction("save");
    try {
      const body = {
        name: projectName.trim() || "Untitled project",
        canvas: documentRef.current,
        previewUrl,
      };

      if (!activeProjectId) {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || !data?.project) {
          throw new Error(data?.error || "Project creation failed.");
        }
        const project = data.project as EditorProjectDetail;
        setActiveProjectId(project.id);
        setProjectName(project.name);
        setProjects((current) => [summarizeProject(project), ...current.filter((item) => item.id !== project.id)]);
      } else {
        const response = await fetch(`/api/projects/${activeProjectId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || !data?.project) {
          throw new Error(data?.error || "Project save failed.");
        }
        const project = data.project as EditorProjectDetail;
        setProjectName(project.name);
        setProjects((current) => [summarizeProject(project), ...current.filter((item) => item.id !== project.id)]);
      }

      toast.success("Project saved.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Project save failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  async function saveCanvasToLibrary() {
    const imageDataUrl = getStageDataUrl(stageRef.current, "image/png", zoom);
    if (!imageDataUrl) {
      toast.error("Canvas export failed.");
      return;
    }

    const toastId = toast.loading("Saving image to library...");
    setBusyAction("save-library");
    try {
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${projectName.trim() || "Easy Easel"} canvas`,
          imageDataUrl,
          mimeType: "image/png",
          width: documentRef.current.width,
          height: documentRef.current.height,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.asset) {
        throw new Error(data?.error || "Library save failed.");
      }

      const asset = data.asset as EditorAsset;
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      toast.success("Saved to library.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Library save failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  async function loadProject(projectId: string) {
    if (!projectId) return;
    const toastId = toast.loading("Loading project...");
    try {
      const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        throw new Error(data?.error || "Project loading failed.");
      }
      const project = data.project as EditorProjectDetail;
      setActiveProjectId(project.id);
      setProjectName(project.name);
      resetDocument(project.canvas);
      setProjects((current) => [summarizeProject(project), ...current.filter((item) => item.id !== project.id)]);
      toast.success("Project loaded.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Project loading failed.", { id: toastId });
    }
  }

  function startNewProject() {
    setActiveProjectId(null);
    setProjectName("Untitled project");
    resetDocument(createEmptyEditorDocument());
    setSelectedLayerId(null);
    setAiPrompt("");
    toast.message("Fresh canvas ready.");
  }

  function exportImage(format: "png" | "jpeg") {
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const dataUrl = getStageDataUrl(stageRef.current, mimeType, zoom);
    if (!dataUrl) {
      toast.error("Canvas export failed.");
      return;
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${slugify(projectName || "easy-easel")}.${format === "jpeg" ? "jpg" : format}`;
    link.click();
  }

  const groupedAssets = useMemo(() => ({
    upload: assets.filter((asset) => asset.type === "upload"),
    generated: assets.filter((asset) => asset.type === "generated"),
    edited: assets.filter((asset) => asset.type === "edited"),
  }), [assets]);

  const canvasWidth = Math.round(document.width * zoom);
  const canvasHeight = Math.round(document.height * zoom);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,183,212,0.42),_transparent_28%),linear-gradient(180deg,_#fff6d6_0%,_#fff7fb_48%,_#fff0b8_100%)] text-[#5f2141]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 md:px-6 md:py-6">
        <section className="rounded-[1.8rem] border border-pink-200/80 bg-white/82 p-4 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-yellow-300 bg-yellow-100/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-pink-700">
                Easy Easel
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#7a1f4f]">Paint manually, or describe the change and let AI make it.</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="min-w-[220px] rounded-full border border-pink-200 bg-white px-4 py-2 text-sm text-[#6d2141] outline-none"
                placeholder="Project name"
              />
              <select
                value={activeProjectId || ""}
                onChange={(event) => void loadProject(event.target.value)}
                className="rounded-full border border-pink-200 bg-white px-4 py-2 text-sm text-[#6d2141] outline-none"
              >
                <option value="">Recent projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => startNewProject()} className="rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-medium text-pink-700 hover:bg-pink-100">
                New project
              </button>
              <button type="button" onClick={() => void saveProject()} disabled={busyAction === "save"} className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-4 py-2 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(255,95,178,0.28)] disabled:opacity-60">
                {busyAction === "save" ? "Saving..." : "Save project"}
              </button>
              <button type="button" onClick={() => void saveCanvasToLibrary()} disabled={busyAction === "save-library"} className="rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-medium text-pink-700 hover:bg-pink-100 disabled:opacity-60">
                {busyAction === "save-library" ? "Saving..." : "Save to library"}
              </button>
              <button type="button" onClick={() => exportImage("png")} className="rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-900 hover:bg-yellow-100">
                Export PNG
              </button>
              <button type="button" onClick={() => exportImage("jpeg")} className="rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-900 hover:bg-yellow-100">
                Export JPEG
              </button>
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[110px_minmax(0,1fr)_360px]">
          <aside className="rounded-[1.8rem] border border-pink-200/80 bg-white/82 p-3 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
            <div className="space-y-2">
              <ToolbarButton active={tool === "select"} onClick={() => setTool("select")} label="Select" />
              <ToolbarButton active={tool === "brush"} onClick={() => setTool("brush")} label="Brush" />
              <ToolbarButton active={tool === "eraser"} onClick={() => setTool("eraser")} label="Eraser" />
              <ToolbarButton active={false} onClick={() => addShape("rect")} label="Rect" />
              <ToolbarButton active={false} onClick={() => addShape("ellipse")} label="Ellipse" />
              <ToolbarButton active={false} onClick={() => addTextLayer()} label="Text" />
              <ToolbarButton active={tool === "crop"} onClick={() => setTool("crop")} label="Crop" />
              <div className="rounded-[1.3rem] border border-pink-100 bg-pink-50/70 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pink-500">Color</p>
                <div className="mt-3 grid gap-2">
                  <label className="text-xs text-pink-700">
                    Stroke
                    <input type="color" value={strokeColor} onChange={(event) => setStrokeColor(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-pink-200 bg-white" />
                  </label>
                  <label className="text-xs text-pink-700">
                    Fill
                    <input type="color" value={fillColor} onChange={(event) => setFillColor(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-pink-200 bg-white" />
                  </label>
                </div>
              </div>
              <div className="grid gap-2">
                <button type="button" onClick={() => undo()} disabled={historyState.index === 0} className="rounded-full border border-pink-200 bg-white px-3 py-2 text-sm font-medium text-pink-700 disabled:opacity-50">Undo</button>
                <button type="button" onClick={() => redo()} disabled={historyState.index >= historyState.snapshots.length - 1} className="rounded-full border border-pink-200 bg-white px-3 py-2 text-sm font-medium text-pink-700 disabled:opacity-50">Redo</button>
              </div>
            </div>
          </aside>

          <section className="rounded-[1.8rem] border border-yellow-200/80 bg-white/78 p-4 shadow-[0_18px_60px_rgba(255,208,64,0.18)] backdrop-blur">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-sm font-medium text-pink-700">{tool}</span>
                <span className="rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1 text-sm font-medium text-yellow-900">{document.width} x {document.height}</span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setZoom((current) => Math.max(0.3, Number((current - 0.1).toFixed(2))))} className="rounded-full border border-pink-200 bg-white px-3 py-1.5 text-sm text-pink-700">-</button>
                <span className="min-w-[70px] text-center text-sm font-medium text-pink-700">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom((current) => Math.min(2, Number((current + 0.1).toFixed(2))))} className="rounded-full border border-pink-200 bg-white px-3 py-1.5 text-sm text-pink-700">+</button>
              </div>
            </div>

            <div className="max-h-[74vh] overflow-auto rounded-[1.5rem] border border-pink-100 bg-[linear-gradient(135deg,_rgba(255,250,214,0.5),_rgba(255,241,247,0.8))] p-4">
              <div style={{ width: canvasWidth, height: canvasHeight }}>
                <Stage
                  ref={stageRef}
                  width={document.width}
                  height={document.height}
                  scaleX={zoom}
                  scaleY={zoom}
                  onMouseDown={handleStageMouseDown}
                  onMouseMove={handleStageMouseMove}
                  onMouseUp={handleStageMouseUp}
                  className="rounded-[1.25rem] bg-white shadow-[0_16px_40px_rgba(255,199,223,0.4)]"
                >
                  <Layer>
                    <Rect width={document.width} height={document.height} fill={document.backgroundColor} listening={false} />
                    {document.layers.map((layer) => renderLayer({
                      layer,
                      isSelected: layer.id === selectedLayerId,
                      onSelect: () => setSelectedLayerId(layer.id),
                      onDragEnd: (x, y) => setLayerPosition(layer.id, x, y),
                      onTransformEnd: () => handleTransformEnd(layer.id),
                      onDoubleClick: () => handleTextEdit(layer.id),
                      nodeRefs,
                    }))}
                    {cropRect ? (
                      <Rect
                        x={cropRect.x}
                        y={cropRect.y}
                        width={cropRect.width}
                        height={cropRect.height}
                        stroke="#ff5fb2"
                        dash={[12, 10]}
                        fill="rgba(255,95,178,0.12)"
                      />
                    ) : null}
                    {assistantCursor ? (
                      <Group x={assistantCursor.x} y={assistantCursor.y} listening={false}>
                        <Rect x={12} y={-34} width={96} height={24} cornerRadius={12} fill="#7a1f4f" opacity={0.92} />
                        <KonvaText x={22} y={-28} width={76} text={assistantCursor.label} fontSize={12} fontFamily="Manrope" fill="#fff7fb" />
                        <Line points={[0, 0, 10, -12, 14, -5]} stroke="#7a1f4f" strokeWidth={4} lineCap="round" lineJoin="round" />
                        <Rect x={-6} y={-6} width={12} height={12} cornerRadius={6} fill="#ff5fb2" stroke="#ffffff" strokeWidth={2} />
                      </Group>
                    ) : null}
                    <Transformer ref={transformerRef} rotateEnabled anchorCornerRadius={12} borderStroke="#ff5fb2" anchorFill="#fff7fb" anchorStroke="#ff5fb2" />
                  </Layer>
                </Stage>
              </div>
            </div>
          </section>

          <aside className="rounded-[1.8rem] border border-pink-200/80 bg-white/82 p-4 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
            <div className="space-y-4">
              <details open className="rounded-[1.4rem] border border-pink-100 bg-pink-50/60 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#7a1f4f]">Layers</summary>
                <div className="mt-3 space-y-2">
                  {[...document.layers].reverse().map((layer) => (
                    <div key={layer.id} className={layer.id === selectedLayerId ? "rounded-[1rem] border border-pink-300 bg-white p-3" : "rounded-[1rem] border border-pink-100 bg-white/80 p-3"}>
                      <button type="button" onClick={() => setSelectedLayerId(layer.id)} className="w-full text-left text-sm font-medium text-[#6d2141]">
                        {layer.name}
                      </button>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <button type="button" onClick={() => moveLayer(layer.id, "up")} className="rounded-full border border-yellow-300 bg-yellow-50 px-2 py-1 text-yellow-900">Up</button>
                        <button type="button" onClick={() => moveLayer(layer.id, "down")} className="rounded-full border border-yellow-300 bg-yellow-50 px-2 py-1 text-yellow-900">Down</button>
                        <button type="button" onClick={() => setSelectedLayerId(layer.id)} className="rounded-full border border-pink-200 bg-pink-50 px-2 py-1 text-pink-700">Select</button>
                      </div>
                    </div>
                  ))}
                  {!document.layers.length ? <p className="text-sm text-pink-500">No layers yet.</p> : null}
                </div>
              </details>

              <details open className="rounded-[1.4rem] border border-pink-100 bg-pink-50/60 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#7a1f4f]">Image library</summary>
                <div className="mt-3 space-y-3">
                  <label className="inline-flex cursor-pointer rounded-full border border-pink-200 bg-white px-3 py-2 text-sm font-medium text-pink-700 hover:bg-pink-50">
                    {busyAction === "upload" ? "Uploading..." : "Upload image"}
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadImage(event.target.files?.[0] || null)} />
                  </label>
                  <AssetShelf title="Uploads" assets={groupedAssets.upload} onInsert={insertAssetAsLayer} />
                  <AssetShelf title="Generated" assets={groupedAssets.generated} onInsert={insertAssetAsLayer} />
                  <AssetShelf title="Edited" assets={groupedAssets.edited} onInsert={insertAssetAsLayer} />
                </div>
              </details>

              <details open className="rounded-[1.4rem] border border-pink-100 bg-pink-50/60 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#7a1f4f]">Basic adjustments</summary>
                <div className="mt-3 space-y-3 text-sm text-pink-700">
                  <label className="block">
                    Canvas background
                    <input type="color" value={document.backgroundColor} onChange={(event) => handleBackgroundColorChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-pink-200 bg-white" />
                  </label>
                  <label className="block">
                    Brush size
                    <input type="range" min={2} max={40} value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} className="mt-1 w-full" />
                  </label>
                  {selectedLayer ? (
                    <>
                      <label className="block">
                        Opacity
                        <input
                          type="range"
                          min={0.05}
                          max={1}
                          step={0.05}
                          value={selectedLayer.opacity}
                          onChange={(event) => updateLayer(selectedLayer.id, (layer) => ({ ...layer, opacity: Number(event.target.value) }))}
                          className="mt-1 w-full"
                        />
                      </label>
                      {selectedImageLayer ? (
                        <>
                          <label className="block">
                            Brightness
                            <input
                              type="range"
                              min={-1}
                              max={1}
                              step={0.05}
                              value={selectedImageLayer.brightness}
                              onChange={(event) => updateLayer(selectedImageLayer.id, (layer) => layer.kind === "image" ? { ...layer, brightness: Number(event.target.value) } : layer)}
                              className="mt-1 w-full"
                            />
                          </label>
                          <label className="block">
                            Contrast
                            <input
                              type="range"
                              min={-1}
                              max={1}
                              step={0.05}
                              value={selectedImageLayer.contrast}
                              onChange={(event) => updateLayer(selectedImageLayer.id, (layer) => layer.kind === "image" ? { ...layer, contrast: Number(event.target.value) } : layer)}
                              className="mt-1 w-full"
                            />
                          </label>
                        </>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => duplicateSelectedLayer()} className="rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm font-medium text-yellow-900">Duplicate</button>
                        <button type="button" onClick={() => deleteSelectedLayer()} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700">Delete</button>
                      </div>
                    </>
                  ) : null}
                  {cropRect ? (
                    <button type="button" onClick={() => applyCrop()} className="rounded-full border border-pink-200 bg-pink-100 px-3 py-1.5 text-sm font-medium text-pink-700">
                      Apply crop
                    </button>
                  ) : null}
                </div>
              </details>

              <details open className="rounded-[1.4rem] border border-pink-100 bg-pink-50/60 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#7a1f4f]">AI easel prompt</summary>
                <div className="mt-3 space-y-3">
                  <textarea
                    value={aiPrompt}
                    onChange={(event) => setAiPrompt(event.target.value)}
                    placeholder="Write on the board, highlight something, circle a layer, point at an object, brush a mark, or erase a region."
                    className="min-h-[150px] w-full rounded-[1.25rem] border border-pink-200 bg-white px-4 py-3 text-sm text-[#6d2141] outline-none placeholder:text-pink-300"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => void runAi("generate")} disabled={busyAction !== null} className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                      {busyAction === "generate" ? "Running..." : "Run on easel"}
                    </button>
                    <button type="button" onClick={() => void runAi("edit")} disabled={busyAction !== null} className="rounded-full border border-pink-200 bg-white px-4 py-2 text-sm font-medium text-pink-700 disabled:opacity-60">
                      {busyAction === "edit" ? "Editing..." : "Apply to selected"}
                    </button>
                    <button type="button" onClick={() => void runAi("variation")} disabled={busyAction !== null} className="rounded-full border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-900 disabled:opacity-60 sm:col-span-2">
                      {busyAction === "variation" ? "Varying..." : "Create variations"}
                    </button>
                  </div>
                  <p className="text-xs leading-6 text-pink-500">
                    Prompts here only use easel tools. Ask it to write text, add boxes or circles, point with arrows, brush marks, or erase directly on the canvas.
                  </p>
                </div>
              </details>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function renderLayer(input: {
  layer: EditorLayer;
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onTransformEnd: () => void;
  onDoubleClick: () => void;
  nodeRefs: React.MutableRefObject<Record<string, Konva.Group | null>>;
}) {
  const commonProps = {
    key: input.layer.id,
    x: input.layer.x,
    y: input.layer.y,
    rotation: input.layer.rotation,
    opacity: input.layer.opacity,
    draggable: true,
    ref: (node: Konva.Group | null) => {
      input.nodeRefs.current[input.layer.id] = node;
    },
    onClick: input.onSelect,
    onTap: input.onSelect,
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => input.onDragEnd(event.target.x(), event.target.y()),
    onTransformEnd: input.onTransformEnd,
  };

  if (input.layer.kind === "image") {
    return (
      <Group {...commonProps}>
        <CanvasImage layer={input.layer} />
      </Group>
    );
  }

  if (input.layer.kind === "text") {
    return (
      <Group {...commonProps} onDblClick={input.onDoubleClick} onDblTap={input.onDoubleClick}>
        <KonvaText
          text={input.layer.text}
          width={input.layer.width}
          fontSize={input.layer.fontSize}
          fill={input.layer.fill}
          fontFamily={input.layer.fontFamily}
          lineHeight={1.1}
        />
      </Group>
    );
  }

  if (input.layer.kind === "rect") {
    return (
      <Group {...commonProps}>
        <Rect width={input.layer.width} height={input.layer.height} fill={input.layer.fill} stroke={input.layer.stroke} strokeWidth={input.layer.strokeWidth} cornerRadius={18} />
      </Group>
    );
  }

  if (input.layer.kind === "ellipse") {
    return (
      <Group {...commonProps}>
        <Ellipse x={input.layer.width / 2} y={input.layer.height / 2} radiusX={input.layer.width / 2} radiusY={input.layer.height / 2} fill={input.layer.fill} stroke={input.layer.stroke} strokeWidth={input.layer.strokeWidth} />
      </Group>
    );
  }

  return (
    <Group {...commonProps} draggable={false}>
      <Line
        points={input.layer.points}
        stroke={input.layer.stroke}
        strokeWidth={input.layer.strokeWidth}
        lineCap="round"
        lineJoin="round"
        globalCompositeOperation={input.layer.compositeMode}
      />
    </Group>
  );
}

function CanvasImage({ layer }: { layer: EditorImageLayer }) {
  const imageRef = useRef<Konva.Image | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const nextImage = new window.Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = layer.src;
    return () => {
      setImage(null);
    };
  }, [layer.src]);

  useEffect(() => {
    const node = imageRef.current;
    if (!node || !image) return;
    node.cache();
    node.getLayer()?.batchDraw();
  }, [image, layer.brightness, layer.contrast]);

  return (
    <KonvaImage
      ref={imageRef}
      image={image}
      width={layer.width}
      height={layer.height}
      filters={[Konva.Filters.Brighten, Konva.Filters.Contrast]}
      brightness={layer.brightness}
      contrast={layer.contrast * 100}
    />
  );
}

function AssetShelf({ title, assets, onInsert }: { title: string; assets: EditorAsset[]; onInsert: (asset: EditorAsset) => void }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-500">{title}</p>
      <div className="mt-2 max-h-[24rem] space-y-2 overflow-y-auto pr-1">
        {assets.length ? assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => onInsert(asset)}
            className="flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-[1rem] border border-pink-100 bg-white p-2 text-left hover:border-pink-200"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[radial-gradient(circle_at_top,_rgba(255,236,171,0.9),_rgba(255,246,250,0.95)_58%,_rgba(255,255,255,0.98)_100%)] p-1.5">
              <img src={asset.imageUrl} alt={asset.title} className="max-h-full w-full rounded-lg object-contain" />
            </div>
            <span className="min-w-0 flex-1 overflow-hidden text-sm leading-5 text-[#6d2141]">
              <span className="block truncate font-medium">{asset.title}</span>
              <span className="block truncate text-xs text-pink-500">Tap to place on canvas</span>
            </span>
          </button>
        )) : <p className="text-sm text-pink-400">No items yet.</p>}
      </div>
    </div>
  );
}

function ToolbarButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active
        ? "w-full rounded-[1.2rem] border border-pink-300 bg-pink-100 px-3 py-2 text-sm font-semibold text-pink-700"
        : "w-full rounded-[1.2rem] border border-pink-100 bg-white px-3 py-2 text-sm font-medium text-pink-700 hover:bg-pink-50"
      }
    >
      {label}
    </button>
  );
}

function summarizeProject(project: EditorProjectDetail): EditorProjectSummary {
  return {
    id: project.id,
    name: project.name,
    previewUrl: project.previewUrl,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function getStageDataUrl(stage: Konva.Stage | null, mimeType: string, zoom: number) {
  if (!stage) return null;
  const previousScaleX = stage.scaleX();
  const previousScaleY = stage.scaleY();
  stage.scale({ x: 1, y: 1 });
  stage.batchDraw();
  const dataUrl = stage.toDataURL({ pixelRatio: 2, mimeType });
  stage.scale({ x: previousScaleX || zoom, y: previousScaleY || zoom });
  stage.batchDraw();
  return dataUrl;
}

function getCanvasPointer(stage: Konva.Stage | null, zoom: number) {
  if (!stage) return null;
  const point = stage.getPointerPosition();
  if (!point) return null;
  return {
    x: point.x / zoom,
    y: point.y / zoom,
  };
}

function serializeDocument(document: EditorCanvasDocument) {
  return JSON.stringify(document);
}

function deserializeDocument(value: string) {
  return JSON.parse(value) as EditorCanvasDocument;
}

function resolveSelectedLayerId(document: EditorCanvasDocument, selectedLayerId: string | null | undefined) {
  if (selectedLayerId && document.layers.some((layer) => layer.id === selectedLayerId)) {
    return selectedLayerId;
  }
  return getTopLayerId(document);
}

function getTopLayerId(document: EditorCanvasDocument) {
  return document.layers[document.layers.length - 1]?.id || null;
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "easy-easel";
}

function normalizeCropRect(x1: number, y1: number, x2: number, y2: number): EditorCropRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  };
}

function shiftPoints(points: number[], xOffset: number, yOffset: number) {
  const nextPoints = [...points];
  for (let index = 0; index < nextPoints.length; index += 2) {
    nextPoints[index] -= xOffset;
    nextPoints[index + 1] -= yOffset;
  }
  return nextPoints;
}

function buildLayerFromAssistAction(action: EditorAssistAction, document: EditorCanvasDocument): EditorLayer | null {
  if (action.tool === "text") {
    const text = String(action.text || "").trim();
    if (!text) return null;
    return {
      id: createId("text"),
      kind: "text",
      name: action.label || "Text",
      x: Number(action.x || 0),
      y: Number(action.y || 0),
      width: Math.max(120, Math.round(Number(action.width || 320))),
      height: Math.max(48, Math.round(Number(action.fontSize || 42) * 1.8)),
      rotation: 0,
      opacity: 1,
      text,
      fill: String(action.color || "#7a1f4f"),
      fontSize: Math.max(18, Math.round(Number(action.fontSize || 42))),
      fontFamily: "Manrope",
    };
  }

  if (action.tool === "rect" || action.tool === "ellipse") {
    return {
      id: createId(action.tool),
      kind: action.tool,
      name: action.label || (action.tool === "ellipse" ? "Ellipse" : "Rectangle"),
      x: Number(action.x || 0),
      y: Number(action.y || 0),
      width: Math.max(8, Math.round(Number(action.width || 220))),
      height: Math.max(8, Math.round(Number(action.height || 120))),
      rotation: 0,
      opacity: 1,
      fill: String(action.fill || "rgba(255,95,178,0.12)"),
      stroke: String(action.stroke || "#ff5fb2"),
      strokeWidth: Math.max(1, Math.round(Number(action.strokeWidth || 4))),
    };
  }

  if (action.tool === "brush" || action.tool === "eraser" || action.tool === "arrow") {
    const points = Array.isArray(action.points)
      ? action.points.map((point) => Number(point)).filter((point) => Number.isFinite(point))
      : [];
    if (points.length < 4) return null;
    return {
      id: createId(action.tool === "eraser" ? "erase" : action.tool === "arrow" ? "arrow" : "brush"),
      kind: "line",
      name: action.label || (action.tool === "eraser" ? "Erase" : action.tool === "arrow" ? "Arrow" : "Brush stroke"),
      x: 0,
      y: 0,
      width: document.width,
      height: document.height,
      rotation: 0,
      opacity: 1,
      points,
      stroke: action.tool === "eraser" ? "#ffffff" : String(action.stroke || "#ff8a5b"),
      strokeWidth: Math.max(2, Math.round(Number(action.strokeWidth || (action.tool === "eraser" ? 24 : action.tool === "arrow" ? 8 : 8)))),
      compositeMode: action.tool === "eraser" ? "destination-out" : "source-over",
    };
  }

  return null;
}

function cursorWaypointsForAction(action: EditorAssistAction) {
  if (action.tool === "brush" || action.tool === "eraser") {
    const points = Array.isArray(action.points) ? action.points : [];
    const waypoints: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < points.length - 1; index += 2) {
      waypoints.push({ x: Number(points[index]), y: Number(points[index + 1]) });
    }
    return waypoints;
  }

  if (action.tool === "rect") {
    const x = Number(action.x || 0);
    const y = Number(action.y || 0);
    const width = Number(action.width || 0);
    const height = Number(action.height || 0);
    return [
      { x, y },
      { x: x + width / 2, y: y + height / 2 },
    ];
  }

  if (action.tool === "ellipse") {
    const x = Number(action.x || 0);
    const y = Number(action.y || 0);
    const width = Number(action.width || 0);
    const height = Number(action.height || 0);
    return [
      { x: x + width / 2, y: y + height / 2 },
      { x: x + width, y: y + height / 2 },
    ];
  }

  if (action.tool === "text") {
    const x = Number(action.x || 0);
    const y = Number(action.y || 0);
    const width = Number(action.width || 0);
    return [{ x: x + Math.max(24, width / 2), y: y + 20 }];
  }

  return [];
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), ms);
  });
}
