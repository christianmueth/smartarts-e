"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import type { EditorAsset } from "@/types/easy-easel";

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

export default function EEditorWorkspace({ initialAssets }: { initialAssets: EditorAsset[] }) {
  const initialLibrary = useMemo<LibraryItem[]>(() => initialAssets.map((asset) => ({
    id: asset.id,
    title: asset.title,
    imageUrl: asset.imageUrl,
    assetId: asset.id,
    kind: asset.type === "generated" ? "generated" : asset.type === "edited" ? "edit" : "upload",
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
      const layer: EditorLayer = { id: createId("text"), name: "Text", type: "text", x: point.x, y: point.y, width: 260, height: 48, rotation: 0, opacity: 1, visible: true, text: "Text", color: "#20312b" };
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
        color: isEraser ? "#ffffff" : "#1b8477",
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
      toast.message(`${label} preview created as a new layer.`, { description: error instanceof Error ? error.message : undefined });
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
    context.fillStyle = "#f8f8f3";
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
          context.fillStyle = layer.color || "#20312b";
          context.font = "600 32px Manrope";
          context.fillText(layer.text || "Text", -layer.width / 2, 10, layer.width);
        } else if (layer.type === "shape") {
          context.fillStyle = layer.color || "#ff7b5c";
          context.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
        } else if (layer.type === "drawing" && layer.points?.length) {
          context.strokeStyle = layer.color || "#1b8477";
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
    <main className="min-h-[calc(100vh-4.5rem)] bg-[#eef1eb] px-3 py-3 text-[#20312b] sm:px-5">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 border-b border-[#cfd8ce] pb-3">
        <div>
          <h1 className="text-lg font-semibold tracking-normal">E-Editor</h1>
          <p className="text-xs text-[#5c6c63]">Image editing with non-destructive AI versions</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" title="Undo" onClick={undo} disabled={historyIndex === 0} className="grid h-9 w-9 place-items-center border border-[#b9c8bd] bg-white text-lg disabled:opacity-35">↶</button>
          <button type="button" title="Redo" onClick={redo} disabled={historyIndex === history.length - 1} className="grid h-9 w-9 place-items-center border border-[#b9c8bd] bg-white text-lg disabled:opacity-35">↷</button>
          <button type="button" onClick={() => void exportImage("png")} className="border border-[#b9c8bd] bg-white px-3 py-2 text-xs font-semibold">PNG</button>
          <button type="button" onClick={() => void exportImage("jpeg")} className="border border-[#b9c8bd] bg-white px-3 py-2 text-xs font-semibold">JPG</button>
          <button type="button" onClick={saveProject} className="bg-[#1b8477] px-3 py-2 text-xs font-semibold text-white">Save project</button>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1600px] gap-3 py-3 xl:grid-cols-[68px_minmax(0,1fr)_330px]">
        <aside className="flex flex-row gap-1 border border-[#cfd8ce] bg-[#f8f9f5] p-1 xl:flex-col xl:items-center">
          {tools.map((item) => <button key={item.id} type="button" title={item.label} onClick={() => setTool(item.id)} className={tool === item.id ? "grid h-11 w-11 place-items-center bg-[#1b8477] text-lg text-white" : "grid h-11 w-11 place-items-center text-lg hover:bg-[#dce8df]"}>{item.symbol}</button>)}
        </aside>

        <section className="min-w-0 overflow-auto border border-[#cfd8ce] bg-[#dfe7df] p-4">
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
            className="relative mx-auto aspect-[25/16] w-full min-w-[680px] max-w-[1000px] overflow-hidden bg-[#f8f8f3] shadow-[0_14px_26px_rgba(36,61,48,0.18)]"
          >
            <div className="pointer-events-none absolute inset-0 opacity-[0.32] [background-image:linear-gradient(#cdd9cf_1px,transparent_1px),linear-gradient(90deg,#cdd9cf_1px,transparent_1px)] [background-size:40px_40px]" />
            {layers.filter((layer) => layer.visible).map((layer) => <CanvasLayer key={layer.id} layer={layer} selected={layer.id === selectedLayerId} onPointerDown={(event) => beginLayerPointer(event, layer)} />)}
            {draftPoints?.length ? <svg className="pointer-events-none absolute inset-0 h-full w-full"><polyline points={draftPoints.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={tool === "eraser" ? "#ffffff" : "#1b8477"} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
          </div>
        </section>

        <aside className="space-y-3">
          <section className="border border-[#cfd8ce] bg-[#f8f9f5] p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Image library</h2><button type="button" onClick={() => inputRef.current?.click()} className="border border-[#b9c8bd] bg-white px-2 py-1 text-xs font-semibold">Upload</button></div>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void uploadImage(event.target.files?.[0] || null)} />
            <div className="grid max-h-40 grid-cols-4 gap-2 overflow-y-auto">
              {library.length ? library.map((asset) => <button key={asset.id} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("e-editor-asset", asset.id)} onClick={() => addImage(asset)} title={`Place ${asset.title}`} className="aspect-square overflow-hidden border border-[#cfd8ce] bg-white"><img src={asset.imageUrl} alt={asset.title} className="h-full w-full object-cover" /></button>) : <p className="col-span-4 py-4 text-center text-xs text-[#5c6c63]">Upload or drag an image here.</p>}
            </div>
          </section>

          <section className="border border-[#cfd8ce] bg-[#f8f9f5] p-3">
            <h2 className="mb-2 text-sm font-semibold">AI actions</h2>
            <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Describe the edit" className="mb-2 min-h-16 w-full resize-none border border-[#b9c8bd] bg-white p-2 text-xs outline-none focus:border-[#1b8477]" />
            <div className="grid grid-cols-2 gap-1">
              {aiActions.map(([id, label]) => <button key={id} type="button" onClick={() => void runAiAction(id, label)} disabled={runningAiAction !== null} className="border border-[#b9c8bd] bg-white px-2 py-2 text-left text-xs font-medium hover:bg-[#e4f1e9] disabled:opacity-40">{runningAiAction === id ? "Working..." : label}</button>)}
            </div>
          </section>

          {selectedLayer ? <section className="border border-[#cfd8ce] bg-[#f8f9f5] p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Selection</h2><span className="text-xs text-[#5c6c63]">{selectedLayer.type}</span></div>
            {selectedLayer.type === "text" ? <input value={selectedLayer.text || ""} onChange={(event) => updateSelected((layer) => ({ ...layer, text: event.target.value }), "Edit text")} className="mb-2 w-full border border-[#b9c8bd] bg-white p-2 text-xs" /> : null}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label>Size<input type="range" min="80" max="760" value={selectedLayer.width} onChange={(event) => updateSelected((layer) => ({ ...layer, width: Number(event.target.value), height: Math.max(42, Number(event.target.value) * (layer.height / layer.width)) }), "Resize layer")} className="w-full accent-[#1b8477]" /></label>
              <label>Rotate<input type="range" min="-180" max="180" value={selectedLayer.rotation} onChange={(event) => updateSelected((layer) => ({ ...layer, rotation: Number(event.target.value) }), "Rotate layer")} className="w-full accent-[#1b8477]" /></label>
              <label className="col-span-2">Opacity<input type="range" min="0" max="1" step="0.05" value={selectedLayer.opacity} onChange={(event) => updateSelected((layer) => ({ ...layer, opacity: Number(event.target.value) }), "Adjust opacity")} className="w-full accent-[#1b8477]" /></label>
            </div>
          </section> : null}

          <section className="border border-[#cfd8ce] bg-[#f8f9f5] p-3">
            <h2 className="mb-2 text-sm font-semibold">Layers</h2>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {[...layers].reverse().map((layer) => <div key={layer.id} className={layer.id === selectedLayerId ? "flex items-center gap-1 border border-[#1b8477] bg-[#e4f1e9] p-1" : "flex items-center gap-1 border border-[#d7dfd6] bg-white p-1"}>
                <button type="button" title={layer.visible ? "Hide layer" : "Show layer"} onClick={() => updateLayerById(layer.id, (current) => ({ ...current, visible: !current.visible }), "Toggle layer visibility")} className="w-6 text-xs">{layer.visible ? "◉" : "○"}</button>
                <button type="button" onClick={() => setSelectedLayerId(layer.id)} className="min-w-0 flex-1 truncate text-left text-xs">{layer.name}</button>
                <button type="button" title="Raise layer" onClick={() => reorderLayer(layer.id, 1)} className="w-5 text-xs">↑</button>
                <button type="button" title="Lower layer" onClick={() => reorderLayer(layer.id, -1)} className="w-5 text-xs">↓</button>
                <button type="button" title="Duplicate layer" onClick={() => { const copy = { ...layer, id: createId("copy"), name: `${layer.name} copy`, x: layer.x + 16, y: layer.y + 16 }; commitLayers([...layersRef.current, copy], "Duplicate layer"); setSelectedLayerId(copy.id); }} className="w-5 text-xs">⧉</button>
                <button type="button" title="Delete layer" onClick={() => { commitLayers(layersRef.current.filter((current) => current.id !== layer.id), "Delete layer"); setSelectedLayerId(null); }} className="w-5 text-xs">×</button>
              </div>)}
            </div>
          </section>

          <section className="border border-[#cfd8ce] bg-[#f8f9f5] p-3">
            <h2 className="mb-2 text-sm font-semibold">Version history</h2>
            <div className="max-h-36 space-y-1 overflow-y-auto">{history.map((snapshot, index) => <button key={snapshot.id} type="button" onClick={() => restoreVersion(index)} className={index === historyIndex ? "block w-full bg-[#1b8477] px-2 py-1.5 text-left text-xs text-white" : "block w-full border border-[#d7dfd6] bg-white px-2 py-1.5 text-left text-xs"}>{index === 0 ? "Original" : `Edit ${index}`}: {snapshot.label}</button>)}</div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function CanvasLayer({ layer, selected, onPointerDown }: { layer: EditorLayer; selected: boolean; onPointerDown: (event: PointerEvent<HTMLDivElement>) => void }) {
  const style = { left: `${(layer.x / CANVAS_WIDTH) * 100}%`, top: `${(layer.y / CANVAS_HEIGHT) * 100}%`, width: `${(layer.width / CANVAS_WIDTH) * 100}%`, height: `${(layer.height / CANVAS_HEIGHT) * 100}%`, transform: `rotate(${layer.rotation}deg)`, opacity: layer.opacity };
  if (layer.type === "drawing") return <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}><polyline points={layer.points?.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={layer.color} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <div onPointerDown={onPointerDown} className={selected ? "absolute cursor-move border-2 border-[#1b8477]" : "absolute cursor-move border-2 border-transparent"} style={style}>
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