"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import type { EditorAsset } from "@/types/easy-easel";
import type { StudioLibraryAsset } from "@/lib/studio";

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 640;
const STORAGE_KEY = "e-editor-workspace-v1";

type Tool = "move" | "crop" | "brush" | "eraser" | "text" | "shape";
type LayerType = "image" | "text" | "shape" | "drawing";
type Point = { x: number; y: number };

type EditorLayer = {
  id: string;
  name: string;
  type: LayerType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  src?: string;
  assetId?: string;
  text?: string;
  color?: string;
  points?: Point[];
  crop?: number;
  filter?: string;
};

type Snapshot = { id: string; label: string; layers: EditorLayer[] };
type LibraryItem = { id: string; title: string; imageUrl: string; assetId?: string; kind: "upload" | "generated" | "edit" };
type DragState = { layerId: string; origin: Point; layerOrigin: Point } | null;

const tools: Array<{ id: Tool; symbol: string; label: string }> = [
  { id: "move", symbol: "↖", label: "Move" },
  { id: "crop", symbol: "⌗", label: "Crop" },
  { id: "brush", symbol: "╱", label: "Brush" },
  { id: "eraser", symbol: "⌫", label: "Eraser" },
  { id: "text", symbol: "T", label: "Text" },
  { id: "shape", symbol: "◇", label: "Shape" },
];

const aiActions = [
  ["remove-background", "Remove background"],
  ["remove-object", "Remove object"],
  ["replace-object", "Replace object"],
  ["expand", "Expand image"],
  ["inpaint", "Inpaint"],
  ["restyle", "Restyle"],
  ["upscale", "Upscale"],
  ["enhance", "Relight / enhance"],
] as const;

export default function EEditorWorkspace({ initialAssets }: { initialAssets: StudioLibraryAsset[] }) {
  const initialLibrary = useMemo<LibraryItem[]>(() => initialAssets.map((asset) => ({
    id: asset.id,
    title: asset.title,
    imageUrl: asset.sourceUrl,
    assetId: asset.id,
    kind: asset.projectName === "Generated" ? "generated" : "edit",
  })), [initialAssets]);
  const [library, setLibrary] = useState(initialLibrary);
  const [layers, setLayers] = useState<EditorLayer[]>([]);
  const layersRef = useRef(layers);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("move");
  const [history, setHistory] = useState<Snapshot[]>([{ id: "original", label: "Original", layers: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [dragState, setDragState] = useState<DragState>(null);
  const [draftPoints, setDraftPoints] = useState<Point[] | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [runningAiAction, setRunningAiAction] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { layers?: EditorLayer[]; history?: Snapshot[]; historyIndex?: number };
      if (Array.isArray(parsed.layers) && Array.isArray(parsed.history)) {
        setLayers(parsed.layers);
        layersRef.current = parsed.layers;
        setHistory(parsed.history);
        setHistoryIndex(Math.min(Math.max(0, parsed.historyIndex || 0), parsed.history.length - 1));
        setSelectedLayerId(parsed.layers.at(-1)?.id || null);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const isMeta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (isMeta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (isMeta && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (isMeta && key === "d" && selectedLayerId) {
        event.preventDefault();
        const layer = layersRef.current.find((item) => item.id === selectedLayerId);
        if (!layer) return;
        const copy = { ...layer, id: createId("copy"), name: `${layer.name} copy`, x: layer.x + 16, y: layer.y + 16 };
        commitLayers([...layersRef.current, copy], "Duplicate layer");
        setSelectedLayerId(copy.id);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedLayerId) {
        event.preventDefault();
        commitLayers(layersRef.current.filter((layer) => layer.id !== selectedLayerId), "Delete layer");
        setSelectedLayerId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [historyIndex, selectedLayerId]);

  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) || null;

  function commitLayers(nextLayers: EditorLayer[], label: string) {
    const snapshot: Snapshot = { id: createId("version"), label, layers: cloneLayers(nextLayers) };
    setLayers(nextLayers);
    layersRef.current = nextLayers;
    setHistory((current) => {
      const nextHistory = [...current.slice(0, historyIndex + 1), snapshot].slice(-16);
      setHistoryIndex(nextHistory.length - 1);
      return nextHistory;
    });
  }

  function updateSelected(update: (layer: EditorLayer) => EditorLayer, label: string) {
    if (!selectedLayerId) return;
    commitLayers(layersRef.current.map((layer) => layer.id === selectedLayerId ? update(layer) : layer), label);
  }

  function addImage(item: LibraryItem, point: Point = { x: 180, y: 110 }, label = "Place image") {
    const layer: EditorLayer = {
      id: createId("image"),
      name: item.title,
      type: "image",
      x: Math.max(0, Math.min(CANVAS_WIDTH - 420, point.x - 210)),
      y: Math.max(0, Math.min(CANVAS_HEIGHT - 300, point.y - 150)),
      width: 420,
      height: 300,
      rotation: 0,
      opacity: 1,
      visible: true,
      src: item.imageUrl,
      assetId: item.assetId,
    };
    commitLayers([...layersRef.current, layer], label);
    setSelectedLayerId(layer.id);
    setTool("move");
  }

  function canvasPoint(event: PointerEvent<HTMLDivElement>): Point {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * CANVAS_WIDTH,
      y: ((event.clientY - bounds.top) / bounds.height) * CANVAS_HEIGHT,
    };
  }

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    const point = canvasPoint(event);
    if (tool === "brush" || tool === "eraser") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraftPoints([point]);
      return;
    }
    if (tool === "text") {
      const layer: EditorLayer = { id: createId("text"), name: "Text", type: "text", x: point.x, y: point.y, width: 260, height: 48, rotation: 0, opacity: 1, visible: true, text: "Text", color: "#7a1f4f" };
      commitLayers([...layersRef.current, layer], "Add text");
      setSelectedLayerId(layer.id);
      return;
    }
    if (tool === "shape") {
      const layer: EditorLayer = { id: createId("shape"), name: "Shape", type: "shape", x: point.x - 70, y: point.y - 50, width: 140, height: 100, rotation: 0, opacity: 1, visible: true, color: "#ff7b5c" };
      commitLayers([...layersRef.current, layer], "Add shape");
      setSelectedLayerId(layer.id);
      return;
    }
    setSelectedLayerId(null);
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLDivElement>) {
    const point = canvasPoint(event);
    if (draftPoints) {
      setDraftPoints((current) => current ? [...current, point] : current);
      return;
    }
    if (!dragState) return;
    const deltaX = point.x - dragState.origin.x;
    const deltaY = point.y - dragState.origin.y;
    const nextLayers = layersRef.current.map((layer) => layer.id === dragState.layerId ? {
      ...layer,
      x: Math.max(-layer.width / 2, Math.min(CANVAS_WIDTH - layer.width / 2, dragState.layerOrigin.x + deltaX)),
      y: Math.max(-layer.height / 2, Math.min(CANVAS_HEIGHT - layer.height / 2, dragState.layerOrigin.y + deltaY)),
    } : layer);
    setLayers(nextLayers);
    layersRef.current = nextLayers;
  }

  function handleCanvasPointerUp() {
    if (draftPoints && draftPoints.length > 1) {
      const isEraser = tool === "eraser";
      const layer: EditorLayer = {
        id: createId("drawing"),
        name: isEraser ? "Eraser mark" : "Brush stroke",
        type: "drawing",
        x: 0,
        y: 0,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        rotation: 0,
        opacity: 1,
        visible: true,
        points: draftPoints,
        color: isEraser ? "#ffffff" : "#d63384",
      };
      commitLayers([...layersRef.current, layer], isEraser ? "Erase mark" : "Brush stroke");
      setSelectedLayerId(layer.id);
    }
    if (dragState) commitLayers(layersRef.current, "Move layer");
    setDraftPoints(null);
    setDragState(null);
  }

  function beginLayerPointer(event: PointerEvent<HTMLDivElement>, layer: EditorLayer) {
    event.stopPropagation();
    setSelectedLayerId(layer.id);
    if (tool === "crop" && layer.type === "image") {
      updateSelected((current) => ({ ...current, crop: Math.min(0.28, (current.crop || 0) + 0.06) }), "Crop image");
      return;
    }
    if (tool !== "move") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({ layerId: layer.id, origin: canvasPoint(event), layerOrigin: { x: layer.x, y: layer.y } });
  }

  function reorderLayer(layerId: string, direction: -1 | 1) {
    const current = layersRef.current;
    const index = current.findIndex((layer) => layer.id === layerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    commitLayers(next, direction < 0 ? "Raise layer" : "Lower layer");
  }

  function restoreVersion(index: number) {
    const snapshot = history[index];
    if (!snapshot) return;
    setLayers(cloneLayers(snapshot.layers));
    layersRef.current = cloneLayers(snapshot.layers);
    setHistoryIndex(index);
    setSelectedLayerId(snapshot.layers.at(-1)?.id || null);
  }

  function undo() {
    if (historyIndex > 0) restoreVersion(historyIndex - 1);
  }

  function redo() {
    if (historyIndex < history.length - 1) restoreVersion(historyIndex + 1);
  }

  async function uploadImage(file: File | null) {
    if (!file || !file.type.startsWith("image/")) return;
    const objectUrl = URL.createObjectURL(file);
    const localAsset: LibraryItem = { id: createId("upload"), title: file.name.replace(/\.[^.]+$/, "") || "Uploaded image", imageUrl: objectUrl, kind: "upload" };
    setLibrary((current) => [localAsset, ...current]);
    addImage(localAsset, { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }, "Upload image");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("saved", "true");
    try {
      const response = await fetch("/api/assets/upload", { method: "POST", body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.asset) return;
      const savedAsset: LibraryItem = { id: data.asset.id, assetId: data.asset.id, title: data.asset.title, imageUrl: data.asset.imageUrl, kind: "upload" };
      setLibrary((current) => [savedAsset, ...current.filter((item) => item.id !== localAsset.id)]);
      setLayers((current) => current.map((layer) => layer.src === objectUrl ? { ...layer, src: savedAsset.imageUrl, assetId: savedAsset.assetId } : layer));
    } catch {
      toast.message("Image is available in this editor session.");
    }
  }

  async function generateLibraryImage() {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      toast.error("Describe the image to generate first.");
      return;
    }
    setRunningAiAction("generate");
    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, count: 1 }),
      });
      const data = await response.json().catch(() => null);
      const asset = data?.assets?.[0] as EditorAsset | undefined;
      if (!response.ok || !asset) throw new Error("Image generation is unavailable.");
      const item: LibraryItem = { id: asset.id, assetId: asset.id, title: asset.title, imageUrl: asset.imageUrl, kind: "generated" };
      setLibrary((current) => [item, ...current.filter((currentItem) => currentItem.id !== item.id)]);
      addImage(item, { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }, "Generate image");
      toast.success("Generated image added to the shared library.");
    } catch {
      toast.error("Image generation is unavailable right now.");
    } finally {
      setRunningAiAction(null);
    }
  }

  async function runAiAction(action: (typeof aiActions)[number][0], label: string) {
    if (!selectedLayer || selectedLayer.type !== "image" || !selectedLayer.src) {
      toast.error("Select an image layer first.");
      return;
    }
    const prompt = aiPrompt.trim() || defaultAiPrompt(action);
    const versionLayer: EditorLayer = {
      ...selectedLayer,
      id: createId("ai"),
      name: `${label} version`,
      x: Math.min(CANVAS_WIDTH - selectedLayer.width, selectedLayer.x + 18),
      y: Math.min(CANVAS_HEIGHT - selectedLayer.height, selectedLayer.y + 18),
      filter: previewFilter(action),
    };
    commitLayers([...layersRef.current, versionLayer], label);
    setSelectedLayerId(versionLayer.id);
    setRunningAiAction(action);

    try {
      const response = await fetch("/api/images/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: selectedLayer.assetId, sourceUrl: selectedLayer.src, sourceTitle: selectedLayer.name, prompt, count: 1 }),
      });
      const data = await response.json().catch(() => null);
      const asset = data?.assets?.[0] as EditorAsset | undefined;
      if (!response.ok || !asset) throw new Error(data?.error || "AI edit unavailable");
      const item: LibraryItem = { id: asset.id, assetId: asset.id, title: asset.title, imageUrl: asset.imageUrl, kind: "edit" };
      setLibrary((current) => [item, ...current.filter((currentItem) => currentItem.id !== item.id)]);
      updateLayerById(versionLayer.id, (current) => ({ ...current, src: asset.imageUrl, assetId: asset.id, filter: undefined }), label);
      toast.success(`${label} created as a new layer.`);
    } catch (error) {
      toast.message(`${label} preview created as a new layer.`, { description: "The rendered AI version will be available when the image service is connected." });
    } finally {
      setRunningAiAction(null);
    }
  }

  function updateLayerById(layerId: string, update: (layer: EditorLayer) => EditorLayer, label: string) {
    commitLayers(layersRef.current.map((layer) => layer.id === layerId ? update(layer) : layer), label);
  }

  function saveProject() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ layers, history, historyIndex }));
    toast.success("Project saved in this browser.");
  }

  async function exportImage(type: "png" | "jpeg") {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = CANVAS_WIDTH;
    exportCanvas.height = CANVAS_HEIGHT;
    const context = exportCanvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#fffafc";
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    try {
      for (const layer of layers.filter((item) => item.visible)) {
        context.save();
        context.globalAlpha = layer.opacity;
        context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
        context.rotate((layer.rotation * Math.PI) / 180);
        if (layer.type === "image" && layer.src) {
          const image = await loadImage(layer.src);
          context.drawImage(image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
        } else if (layer.type === "text") {
          context.fillStyle = layer.color || "#7a1f4f";
          context.font = "600 32px Manrope";
          context.fillText(layer.text || "Text", -layer.width / 2, 10, layer.width);
        } else if (layer.type === "shape") {
          context.fillStyle = layer.color || "#ff7b5c";
          context.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
        } else if (layer.type === "drawing" && layer.points?.length) {
          context.strokeStyle = layer.color || "#d63384";
          context.lineWidth = 12;
          context.lineCap = "round";
          context.beginPath();
          layer.points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
          context.stroke();
        }
        context.restore();
      }
      const link = document.createElement("a");
      link.download = `e-editor.${type === "jpeg" ? "jpg" : "png"}`;
      link.href = exportCanvas.toDataURL(`image/${type}`, type === "jpeg" ? 0.92 : undefined);
      link.click();
    } catch {
      toast.error("This image cannot be exported because its source blocks browser canvas access.");
    }
  }

  return (
    <main className="min-h-[calc(100vh-4.5rem)] bg-[linear-gradient(135deg,#fff7fb_0%,#fffef4_48%,#fff2f8_100%)] px-3 py-3 text-[#7a1f4f] sm:px-5">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 border-b border-pink-200 pb-3">
        <div>
          <h1 className="text-lg font-semibold tracking-normal">E-Editor</h1>
          <p className="text-xs text-pink-600">Image editing with non-destructive AI versions</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" title="Undo" onClick={undo} disabled={historyIndex === 0} className="grid h-9 w-9 place-items-center rounded-md border border-pink-200 bg-white text-lg disabled:opacity-35">↶</button>
          <button type="button" title="Redo" onClick={redo} disabled={historyIndex === history.length - 1} className="grid h-9 w-9 place-items-center rounded-md border border-pink-200 bg-white text-lg disabled:opacity-35">↷</button>
          <button type="button" onClick={() => void exportImage("png")} className="rounded-md border border-pink-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-pink-50">PNG</button>
          <button type="button" onClick={() => void exportImage("jpeg")} className="rounded-md border border-pink-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-pink-50">JPG</button>
          <button type="button" onClick={saveProject} className="rounded-md bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-3 py-2 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(255,95,178,0.25)]">Save project</button>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1600px] gap-3 py-3 xl:grid-cols-[68px_minmax(0,1fr)_330px]">
        <aside className="flex flex-row gap-1 rounded-lg border border-pink-200 bg-white/85 p-1 shadow-[0_12px_30px_rgba(255,129,181,0.12)] xl:flex-col xl:items-center">
          {tools.map((item) => <button key={item.id} type="button" title={item.label} onClick={() => setTool(item.id)} className={tool === item.id ? "grid h-11 w-11 place-items-center rounded-md bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] text-lg text-white" : "grid h-11 w-11 place-items-center rounded-md text-lg hover:bg-pink-50"}>{item.symbol}</button>)}
        </aside>

        <section className="min-w-0 overflow-auto rounded-lg border border-pink-200 bg-[linear-gradient(135deg,#fff1f7,#fff8df)] p-4 shadow-[0_16px_42px_rgba(255,129,181,0.12)]">
          <div
            ref={canvasRef}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerUp}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const assetId = event.dataTransfer.getData("e-editor-asset");
              const item = library.find((asset) => asset.id === assetId);
              if (item) addImage(item, canvasPoint(event as unknown as PointerEvent<HTMLDivElement>));
            }}
            className="relative mx-auto aspect-[25/16] w-full min-w-[680px] max-w-[1000px] overflow-hidden rounded-md bg-[#fffafc] shadow-[0_14px_26px_rgba(122,31,79,0.18)]"
          >
            <div className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:linear-gradient(#f4cadc_1px,transparent_1px),linear-gradient(90deg,#f4cadc_1px,transparent_1px)] [background-size:40px_40px]" />
            {layers.filter((layer) => layer.visible).map((layer) => <CanvasLayer key={layer.id} layer={layer} selected={layer.id === selectedLayerId} onPointerDown={(event) => beginLayerPointer(event, layer)} />)}
            {draftPoints?.length ? <svg className="pointer-events-none absolute inset-0 h-full w-full"><polyline points={draftPoints.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={tool === "eraser" ? "#ffffff" : "#d63384"} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
          </div>
        </section>

        <aside className="space-y-3">
          <section className="rounded-lg border border-pink-200 bg-white/90 p-3 shadow-[0_10px_24px_rgba(255,129,181,0.1)]">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Image library</h2><div className="flex gap-1"><button type="button" onClick={() => void generateLibraryImage()} disabled={runningAiAction !== null} className="rounded-md border border-yellow-300 bg-yellow-50 px-2 py-1 text-xs font-semibold text-yellow-900 hover:bg-yellow-100 disabled:opacity-40">Generate</button><button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-pink-200 bg-pink-50 px-2 py-1 text-xs font-semibold text-pink-700 hover:bg-pink-100">Upload</button></div></div>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void uploadImage(event.target.files?.[0] || null)} />
            <div className="grid max-h-40 grid-cols-4 gap-2 overflow-y-auto">
              {library.length ? library.map((asset) => <button key={asset.id} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("e-editor-asset", asset.id)} onClick={() => addImage(asset)} title={`Place ${asset.title}`} className="aspect-square overflow-hidden rounded-md border border-pink-200 bg-white"><img src={asset.imageUrl} alt={asset.title} className="h-full w-full object-cover" /></button>) : <p className="col-span-4 py-4 text-center text-xs text-pink-600">Upload or drag an image here.</p>}
            </div>
          </section>

          <section className="rounded-lg border border-pink-200 bg-white/90 p-3 shadow-[0_10px_24px_rgba(255,129,181,0.1)]">
            <h2 className="mb-2 text-sm font-semibold">AI actions</h2>
            <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Describe the edit" className="mb-2 min-h-16 w-full resize-none rounded-md border border-pink-200 bg-white p-2 text-xs outline-none focus:border-pink-500" />
            <div className="grid grid-cols-2 gap-1">
              {aiActions.map(([id, label]) => <button key={id} type="button" onClick={() => void runAiAction(id, label)} disabled={runningAiAction !== null} className="rounded-md border border-pink-200 bg-white px-2 py-2 text-left text-xs font-medium hover:bg-pink-50 disabled:opacity-40">{runningAiAction === id ? "Working..." : label}</button>)}
            </div>
          </section>

          {selectedLayer ? <section className="rounded-lg border border-pink-200 bg-white/90 p-3 shadow-[0_10px_24px_rgba(255,129,181,0.1)]">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Selection</h2><span className="text-xs text-pink-600">{selectedLayer.type}</span></div>
            {selectedLayer.type === "text" ? <input value={selectedLayer.text || ""} onChange={(event) => updateSelected((layer) => ({ ...layer, text: event.target.value }), "Edit text")} className="mb-2 w-full rounded-md border border-pink-200 bg-white p-2 text-xs" /> : null}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label>Size<input type="range" min="80" max="760" value={selectedLayer.width} onChange={(event) => updateSelected((layer) => ({ ...layer, width: Number(event.target.value), height: Math.max(42, Number(event.target.value) * (layer.height / layer.width)) }), "Resize layer")} className="w-full accent-pink-500" /></label>
              <label>Rotate<input type="range" min="-180" max="180" value={selectedLayer.rotation} onChange={(event) => updateSelected((layer) => ({ ...layer, rotation: Number(event.target.value) }), "Rotate layer")} className="w-full accent-pink-500" /></label>
              <label className="col-span-2">Opacity<input type="range" min="0" max="1" step="0.05" value={selectedLayer.opacity} onChange={(event) => updateSelected((layer) => ({ ...layer, opacity: Number(event.target.value) }), "Adjust opacity")} className="w-full accent-pink-500" /></label>
            </div>
          </section> : null}

          <section className="rounded-lg border border-pink-200 bg-white/90 p-3 shadow-[0_10px_24px_rgba(255,129,181,0.1)]">
            <h2 className="mb-2 text-sm font-semibold">Layers</h2>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {[...layers].reverse().map((layer) => <div key={layer.id} className={layer.id === selectedLayerId ? "flex items-center gap-1 rounded-md border border-pink-400 bg-pink-50 p-1" : "flex items-center gap-1 rounded-md border border-pink-100 bg-white p-1"}>
                <button type="button" title={layer.visible ? "Hide layer" : "Show layer"} onClick={() => updateLayerById(layer.id, (current) => ({ ...current, visible: !current.visible }), "Toggle layer visibility")} className="w-6 text-xs">{layer.visible ? "◉" : "○"}</button>
                <button type="button" onClick={() => setSelectedLayerId(layer.id)} className="min-w-0 flex-1 truncate text-left text-xs">{layer.name}</button>
                <button type="button" title="Raise layer" onClick={() => reorderLayer(layer.id, 1)} className="w-5 text-xs">↑</button>
                <button type="button" title="Lower layer" onClick={() => reorderLayer(layer.id, -1)} className="w-5 text-xs">↓</button>
                <button type="button" title="Duplicate layer" onClick={() => { const copy = { ...layer, id: createId("copy"), name: `${layer.name} copy`, x: layer.x + 16, y: layer.y + 16 }; commitLayers([...layersRef.current, copy], "Duplicate layer"); setSelectedLayerId(copy.id); }} className="w-5 text-xs">⧉</button>
                <button type="button" title="Delete layer" onClick={() => { commitLayers(layersRef.current.filter((current) => current.id !== layer.id), "Delete layer"); setSelectedLayerId(null); }} className="w-5 text-xs">×</button>
              </div>)}
            </div>
          </section>

          <section className="rounded-lg border border-pink-200 bg-white/90 p-3 shadow-[0_10px_24px_rgba(255,129,181,0.1)]">
            <h2 className="mb-2 text-sm font-semibold">Version history</h2>
            <div className="max-h-36 space-y-1 overflow-y-auto">{history.map((snapshot, index) => <button key={snapshot.id} type="button" onClick={() => restoreVersion(index)} className={index === historyIndex ? "block w-full rounded-md bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-2 py-1.5 text-left text-xs text-white" : "block w-full rounded-md border border-pink-100 bg-white px-2 py-1.5 text-left text-xs hover:bg-pink-50"}>{index === 0 ? "Original" : `Edit ${index}`}: {snapshot.label}</button>)}</div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function CanvasLayer({ layer, selected, onPointerDown }: { layer: EditorLayer; selected: boolean; onPointerDown: (event: PointerEvent<HTMLDivElement>) => void }) {
  const style = { left: `${(layer.x / CANVAS_WIDTH) * 100}%`, top: `${(layer.y / CANVAS_HEIGHT) * 100}%`, width: `${(layer.width / CANVAS_WIDTH) * 100}%`, height: `${(layer.height / CANVAS_HEIGHT) * 100}%`, transform: `rotate(${layer.rotation}deg)`, opacity: layer.opacity };
  if (layer.type === "drawing") return <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}><polyline points={layer.points?.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={layer.color} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <div onPointerDown={onPointerDown} className={selected ? "absolute cursor-move border-2 border-pink-500" : "absolute cursor-move border-2 border-transparent"} style={style}>
    {layer.type === "image" ? <img src={layer.src} alt={layer.name} draggable={false} className="h-full w-full object-cover" style={{ filter: layer.filter, clipPath: layer.crop ? `inset(${layer.crop * 100}%)` : undefined }} /> : null}
    {layer.type === "text" ? <div className="h-full w-full px-2 text-3xl font-semibold" style={{ color: layer.color }}>{layer.text}</div> : null}
    {layer.type === "shape" ? <div className="h-full w-full" style={{ background: layer.color }} /> : null}
  </div>;
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneLayers(layers: EditorLayer[]) {
  return layers.map((layer) => ({ ...layer, points: layer.points?.map((point) => ({ ...point })) }));
}

function defaultAiPrompt(action: (typeof aiActions)[number][0]) {
  return ({ "remove-background": "Remove the background.", "remove-object": "Remove the selected object.", "replace-object": "Replace the selected object.", expand: "Expand the image beyond its current edges.", inpaint: "Inpaint the selected area.", restyle: "Restyle this image with a polished editorial look.", upscale: "Upscale and preserve details.", enhance: "Relight and enhance the image." })[action];
}

function previewFilter(action: (typeof aiActions)[number][0]) {
  if (action === "restyle") return "saturate(1.25) contrast(1.08)";
  if (action === "enhance" || action === "upscale") return "brightness(1.08) contrast(1.12)";
  return undefined;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be loaded."));
    image.src = source;
  });
}