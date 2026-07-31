"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text as KonvaText, Transformer } from "react-konva";
import { toast } from "sonner";
import { buildReferencePaintingPlan } from "@/lib/easel-ai-painter";
import { buildStructuredIllustrationPlan } from "@/lib/easel-structured-illustration";
import type {
  EditorAssistAction,
  EditorAssistPlan,
  EditorPaintDetailLevel,
  EditorPaintSession,
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

const LOCAL_EDITOR_PROJECTS_STORAGE_KEY = "easy-easel-local-projects-v1";

export default function EasyEaselEditor({ initialAssets, initialProjects, initialProject }: Props) {
  const initialDocument = initialProject?.canvas || createEmptyEditorDocument();
  const [assets, setAssets] = useState(initialAssets);
  const [projects, setProjects] = useState(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initialProject?.id || null);
  const [projectName, setProjectName] = useState(initialProject?.name || "Untitled project");
  const [document, setDocument] = useState<EditorCanvasDocument>(initialDocument);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [strokeColor, setStrokeColor] = useState("#ff5fb2");
  const [fillColor, setFillColor] = useState("#ffe09c");
  const [brushSize, setBrushSize] = useState(8);
  const [zoom, setZoom] = useState(1);
  const [canvasViewport, setCanvasViewport] = useState({ width: 0, height: 0 });
  const [canvasWidthInput, setCanvasWidthInput] = useState(String(initialDocument.width));
  const [canvasHeightInput, setCanvasHeightInput] = useState(String(initialDocument.height));
  const [aiPrompt, setAiPrompt] = useState("");
  const [paintReferenceAssetId, setPaintReferenceAssetId] = useState<string | null>(null);
  const [paintDetailLevel, setPaintDetailLevel] = useState<EditorPaintDetailLevel>("refined");
  const [activePaintSessionId, setActivePaintSessionId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<null | "upload" | "save" | "save-library" | "generate" | "edit" | "variation" | "export-png" | "export-jpeg">(null);
  const [cropRect, setCropRect] = useState<EditorCropRect | null>(null);
  const [selectionRect, setSelectionRect] = useState<EditorCropRect | null>(null);
  const [lassoPoints, setLassoPoints] = useState<number[]>([]);
  const [assistantCursor, setAssistantCursor] = useState<{ x: number; y: number; label: string } | null>(null);
  const [historyState, setHistoryState] = useState(() => ({
    snapshots: [serializeDocument(initialDocument)],
    index: 0,
  }));

  const documentRef = useRef(document);
  const stageRef = useRef<Konva.Stage | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef<Record<string, Konva.Group | null>>({});
  const isManualZoomRef = useRef(false);
  const isDrawingRef = useRef(false);
  const cropAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const selectionGestureRef = useRef<{ x: number; y: number; mode: "rect" | "lasso" } | null>(null);
  const selectionDragRef = useRef<{ layerIds: string[]; originById: Record<string, { x: number; y: number }>; anchorId: string } | null>(null);
  const selectionBoundsDragRef = useRef<{ layerIds: string[]; originById: Record<string, { x: number; y: number }>; startX: number; startY: number } | null>(null);
  const lastStagePointerDownRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const paintControlRef = useRef<"running" | "paused" | "stopped">("stopped");

  const selectedLayer = useMemo(
    () => document.layers.find((layer) => layer.id === selectedLayerId) ?? document.layers.find((layer) => selectedLayerIds.includes(layer.id)) ?? null,
    [document.layers, selectedLayerId, selectedLayerIds]
  );
  const selectedImageLayer = selectedLayer?.kind === "image" ? selectedLayer as EditorImageLayer : null;
  const selectedLayers = useMemo(
    () => document.layers.filter((layer) => selectedLayerIds.includes(layer.id)),
    [document.layers, selectedLayerIds]
  );
  const multiSelectionBounds = useMemo(
    () => selectedLayers.length > 1 ? getCombinedLayerBounds(selectedLayers) : null,
    [selectedLayers]
  );
  const paintReferenceAsset = useMemo(
    () => assets.find((asset) => asset.id === paintReferenceAssetId) ?? null,
    [assets, paintReferenceAssetId]
  );
  const activePaintSession = useMemo(
    () => document.paintSessions?.find((session) => session.id === activePaintSessionId) ?? null,
    [document.paintSessions, activePaintSessionId]
  );

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    setCanvasWidthInput(String(document.width));
    setCanvasHeightInput(String(document.height));
  }, [document.width, document.height]);

  useEffect(() => {
    const localProjects = readLocalEditorProjects();
    if (!localProjects.length) {
      return;
    }

    setProjects((current) => mergeProjectSummaries(current, localProjects.map(summarizeProject)));
  }, []);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const updateViewport = () => {
      setCanvasViewport({ width: viewport.clientWidth, height: viewport.clientHeight });
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canvasViewport.width || !canvasViewport.height) return;
    if (isManualZoomRef.current) return;
    const horizontalPadding = 32;
    const verticalPadding = 32;
    const fitZoom = Math.min(
      (canvasViewport.width - horizontalPadding) / document.width,
      (canvasViewport.height - verticalPadding) / document.height,
      1
    );
    setZoom(Number(Math.max(0.18, fitZoom).toFixed(3)));
  }, [canvasViewport, document.width, document.height]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const selectedNode = selectedLayerId && selectedLayerIds.length === 1 ? nodeRefs.current[selectedLayerId] : null;
    if (!transformer) return;
    if (selectedNode && selectedLayer?.kind !== "line") {
      transformer.nodes([selectedNode]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [selectedLayerId, selectedLayerIds.length, selectedLayer, document.layers]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();

      if (key === "escape") {
        event.preventDefault();
        setSelection([], null);
        setSelectionRect(null);
        setLassoPoints([]);
        selectionGestureRef.current = null;
        selectionDragRef.current = null;
        selectionBoundsDragRef.current = null;
        cropAnchorRef.current = null;
        return;
      }

      if (shouldIgnoreEditorShortcut(event.target)) {
        return;
      }

      const isMeta = event.metaKey || event.ctrlKey;

      if ((event.key === "Delete" || event.key === "Backspace") && selectedLayerIds.length) {
        event.preventDefault();
        deleteSelectedLayer();
        return;
      }

      if (isMeta && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (isMeta && ((key === "z" && event.shiftKey) || key === "y")) {
        event.preventDefault();
        redo();
        return;
      }

      if (isMeta && key === "d" && selectedLayerIds.length) {
        event.preventDefault();
        duplicateSelectedLayer();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLayerIds, historyState.index, historyState.snapshots.length, selectedLayer]);

  function setSelection(nextLayerIds: string[], nextPrimaryId?: string | null) {
    const resolved = resolveLayerSelection(documentRef.current, nextLayerIds, nextPrimaryId ?? selectedLayerId);
    setSelectedLayerIds(resolved.selectedLayerIds);
    setSelectedLayerId(resolved.selectedLayerId);
  }

  function commitDocument(nextDocument: EditorCanvasDocument, nextSelection?: { selectedLayerId?: string | null; selectedLayerIds?: string[] }) {
    documentRef.current = nextDocument;
    setDocument(nextDocument);
    const resolved = resolveLayerSelection(
      nextDocument,
      nextSelection?.selectedLayerIds ?? selectedLayerIds,
      nextSelection?.selectedLayerId ?? selectedLayerId
    );
    setSelectedLayerIds(resolved.selectedLayerIds);
    setSelectedLayerId(resolved.selectedLayerId);
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

  function resetDocument(nextDocument: EditorCanvasDocument, options?: { selectedLayerId?: string | null; selectedLayerIds?: string[] }) {
    documentRef.current = nextDocument;
    setDocument(nextDocument);
    const resolved = resolveLayerSelection(nextDocument, options?.selectedLayerIds ?? [], options?.selectedLayerId ?? null);
    setSelectedLayerIds(resolved.selectedLayerIds);
    setSelectedLayerId(resolved.selectedLayerId);
    setHistoryState({
      snapshots: [serializeDocument(nextDocument)],
      index: 0,
    });
    setCropRect(null);
    setSelectionRect(null);
    setLassoPoints([]);
  }

  function mutateDocument(
    mutator: (current: EditorCanvasDocument) => EditorCanvasDocument,
    nextSelection?: { selectedLayerId?: string | null; selectedLayerIds?: string[] }
  ) {
    const nextDocument = mutator(documentRef.current);
    commitDocument(nextDocument, nextSelection);
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
      const resolved = resolveLayerSelection(nextDocument, selectedLayerIds, selectedLayerId);
      setSelectedLayerIds(resolved.selectedLayerIds);
      setSelectedLayerId(resolved.selectedLayerId);
      setCropRect(null);
      setSelectionRect(null);
      setLassoPoints([]);
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
      const resolved = resolveLayerSelection(nextDocument, selectedLayerIds, selectedLayerId);
      setSelectedLayerIds(resolved.selectedLayerIds);
      setSelectedLayerId(resolved.selectedLayerId);
      setCropRect(null);
      setSelectionRect(null);
      setLassoPoints([]);
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
    }), { selectedLayerId: id, selectedLayerIds: [id] });
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
    }), { selectedLayerId: id, selectedLayerIds: [id] });
    setTool("select");
  }

  function duplicateSelectedLayer() {
    if (!selectedLayerIds.length) return;
    const duplicates: EditorLayer[] = [];
    for (const layer of documentRef.current.layers.filter((item) => selectedLayerIds.includes(item.id))) {
      const duplicate = JSON.parse(JSON.stringify(layer)) as EditorLayer;
      duplicate.id = createId(layer.kind);
      duplicate.name = `${layer.name} copy`;
      duplicate.x += 24;
      duplicate.y += 24;
      duplicates.push(duplicate);
    }
    if (!duplicates.length) return;
    mutateDocument((current) => ({
      ...current,
      layers: [...current.layers, ...duplicates],
    }), { selectedLayerId: duplicates[duplicates.length - 1]?.id ?? null, selectedLayerIds: duplicates.map((layer) => layer.id) });
  }

  function deleteSelectedLayer() {
    if (!selectedLayerIds.length) return;
    mutateDocument((current) => ({
      ...current,
      layers: current.layers.filter((layer) => !selectedLayerIds.includes(layer.id)),
    }), { selectedLayerId: null, selectedLayerIds: [] });
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
    }, { selectedLayerId: layerId, selectedLayerIds: [layerId] });
  }

  function updateLayer(layerId: string, updater: (layer: EditorLayer) => EditorLayer) {
    mutateDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === layerId ? updater(layer) : layer),
    }), { selectedLayerId: layerId, selectedLayerIds: [layerId] });
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
    }), { selectedLayerId: id, selectedLayerIds: [id] });
  }

  function setLayerPosition(layerId: string, x: number, y: number) {
    updateLayer(layerId, (layer) => ({ ...layer, x, y }));
  }

  function beginSelectionDrag(layerId: string) {
    const activeIds = selectedLayerIds.includes(layerId) ? selectedLayerIds : [layerId];
    selectionDragRef.current = {
      layerIds: activeIds,
      anchorId: layerId,
      originById: Object.fromEntries(
        documentRef.current.layers
          .filter((layer) => activeIds.includes(layer.id))
          .map((layer) => [layer.id, { x: layer.x, y: layer.y }])
      ),
    };
    if (!selectedLayerIds.includes(layerId) || selectedLayerIds.length === 1) {
      setSelection(activeIds, layerId);
    }
  }

  function dragSelection(layerId: string, x: number, y: number) {
    const currentDrag = selectionDragRef.current;
    if (!currentDrag || currentDrag.anchorId !== layerId || currentDrag.layerIds.length < 2) {
      return;
    }
    const anchorOrigin = currentDrag.originById[layerId];
    if (!anchorOrigin) return;
    const dx = x - anchorOrigin.x;
    const dy = y - anchorOrigin.y;
    setLiveDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (!currentDrag.layerIds.includes(layer.id) || layer.id === layerId) {
          return layer;
        }
        const origin = currentDrag.originById[layer.id];
        if (!origin) return layer;
        return {
          ...layer,
          x: origin.x + dx,
          y: origin.y + dy,
        };
      }),
    }));
  }

  function endSelectionDrag(layerId: string, x: number, y: number) {
    const currentDrag = selectionDragRef.current;
    selectionDragRef.current = null;
    if (!currentDrag || currentDrag.anchorId !== layerId || currentDrag.layerIds.length < 2) {
      setLayerPosition(layerId, x, y);
      return;
    }
    const anchorOrigin = currentDrag.originById[layerId];
    if (!anchorOrigin) {
      setLayerPosition(layerId, x, y);
      return;
    }
    const dx = x - anchorOrigin.x;
    const dy = y - anchorOrigin.y;
    mutateDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (!currentDrag.layerIds.includes(layer.id)) {
          return layer;
        }
        const origin = currentDrag.originById[layer.id];
        if (!origin) return layer;
        return {
          ...layer,
          x: layer.id === layerId ? x : origin.x + dx,
          y: layer.id === layerId ? y : origin.y + dy,
        };
      }),
    }), { selectedLayerId: layerId, selectedLayerIds: currentDrag.layerIds });
  }

  function handleSelectionBoundsDragStart() {
    if (!selectedLayerIds.length || !multiSelectionBounds) return;
    selectionBoundsDragRef.current = {
      layerIds: selectedLayerIds,
      startX: multiSelectionBounds.x,
      startY: multiSelectionBounds.y,
      originById: Object.fromEntries(
        documentRef.current.layers
          .filter((layer) => selectedLayerIds.includes(layer.id))
          .map((layer) => [layer.id, { x: layer.x, y: layer.y }])
      ),
    };
  }

  function handleSelectionBoundsDragMove(x: number, y: number) {
    const currentDrag = selectionBoundsDragRef.current;
    if (!currentDrag) return;
    const dx = x - currentDrag.startX;
    const dy = y - currentDrag.startY;
    setLiveDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (!currentDrag.layerIds.includes(layer.id)) {
          return layer;
        }
        const origin = currentDrag.originById[layer.id];
        if (!origin) return layer;
        return {
          ...layer,
          x: origin.x + dx,
          y: origin.y + dy,
        };
      }),
    }));
  }

  function handleSelectionBoundsDragEnd(x: number, y: number) {
    const currentDrag = selectionBoundsDragRef.current;
    selectionBoundsDragRef.current = null;
    if (!currentDrag) return;
    const dx = x - currentDrag.startX;
    const dy = y - currentDrag.startY;
    mutateDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (!currentDrag.layerIds.includes(layer.id)) {
          return layer;
        }
        const origin = currentDrag.originById[layer.id];
        if (!origin) return layer;
        return {
          ...layer,
          x: origin.x + dx,
          y: origin.y + dy,
        };
      }),
    }), { selectedLayerId, selectedLayerIds: currentDrag.layerIds });
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

  function handleStageMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
    const point = getCanvasPointer(stageRef.current, zoom);
    if (!point) return;

    const isStageTarget = event.target === stageRef.current || event.target === event.target.getStage();

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
      setSelection([id], id);
      return;
    }

    if (tool === "crop") {
      cropAnchorRef.current = point;
      setCropRect({ x: point.x, y: point.y, width: 1, height: 1 });
      return;
    }

    if (tool === "select" && isStageTarget) {
      const wantsLasso = event.evt.altKey;
      const lastPointerDown = lastStagePointerDownRef.current;
      const isRapidSecondPress = Boolean(
        lastPointerDown
        && Date.now() - lastPointerDown.time < 360
        && Math.hypot(point.x - lastPointerDown.x, point.y - lastPointerDown.y) < 16
      );
      lastStagePointerDownRef.current = { x: point.x, y: point.y, time: Date.now() };
      const wantsRangeSelection = wantsLasso || isRapidSecondPress || event.evt.detail >= 2 || event.evt.shiftKey;
      if (!wantsRangeSelection) {
        setSelection([], null);
        return;
      }

      selectionGestureRef.current = {
        x: point.x,
        y: point.y,
        mode: wantsLasso ? "lasso" : "rect",
      };
      if (wantsLasso) {
        setLassoPoints([point.x, point.y]);
        setSelectionRect(null);
      } else {
        setSelectionRect({ x: point.x, y: point.y, width: 1, height: 1 });
        setLassoPoints([]);
      }
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
      return;
    }

    if (tool === "select" && selectionGestureRef.current) {
      if (selectionGestureRef.current.mode === "rect") {
        const nextRect = normalizeCropRect(selectionGestureRef.current.x, selectionGestureRef.current.y, point.x, point.y);
        setSelectionRect(nextRect);
        const nextIds = collectLayersInRect(documentRef.current.layers, nextRect).map((layer) => layer.id);
        setSelection(nextIds, nextIds[nextIds.length - 1] ?? null);
        return;
      }

      setLassoPoints((current) => {
        const nextPoints = [...current, point.x, point.y];
        const nextIds = collectLayersInLasso(documentRef.current.layers, nextPoints).map((layer) => layer.id);
        setSelection(nextIds, nextIds[nextIds.length - 1] ?? null);
        return nextPoints;
      });
    }
  }

  function handleStageMouseUp() {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      commitDocument(documentRef.current, { selectedLayerId, selectedLayerIds });
      return;
    }
    if (tool === "crop") {
      cropAnchorRef.current = null;
      return;
    }
    if (tool === "select" && selectionGestureRef.current) {
      selectionGestureRef.current = null;
      setSelectionRect(null);
      setLassoPoints([]);
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
    const topLayerId = getTopLayerId(documentRef.current);
    commitDocument(documentRef.current, { selectedLayerId: topLayerId, selectedLayerIds: topLayerId ? [topLayerId] : [] });
  }

  async function requestEaselAssistPlan(prompt: string) {
    try {
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
    } catch (error) {
      const document = documentRef.current;
      return placeLocalFallbackPlan(
        buildLocalCanvasFallbackPlan(prompt, buildSelectedLayerForAssist(), document),
        prompt,
        document
      );
    }
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
      setSelectedLayerIds([layer.id]);
      setSelectedLayerId(layer.id);
      lastLayerId = layer.id;
      await wait(140);
    }

    setAssistantCursor(null);
    setTool(previousTool);
    commitDocument(workingDocument, { selectedLayerId: lastLayerId, selectedLayerIds: lastLayerId ? [lastLayerId] : [] });
  }

  function updatePaintSession(sessionId: string, update: (session: EditorPaintSession) => EditorPaintSession, commit = false) {
    const apply = (current: EditorCanvasDocument) => ({
      ...current,
      paintSessions: (current.paintSessions || []).map((session) => session.id === sessionId ? update(session) : session),
    });
    if (commit) {
      commitDocument(apply(documentRef.current));
    } else {
      setLiveDocument(apply);
    }
  }

  async function replayPaintSession(sessionId: string) {
    const initialSession = documentRef.current.paintSessions?.find((session) => session.id === sessionId);
    if (!initialSession) return;

    paintControlRef.current = "running";
    setBusyAction("paint");
    setActivePaintSessionId(sessionId);
    updatePaintSession(sessionId, (session) => ({ ...session, status: "painting" }));
    let workingDocument = documentRef.current;
    let lastLayerId = getTopLayerId(workingDocument);

    for (let index = initialSession.completedActionCount; index < initialSession.actions.length; index += 1) {
      while (paintControlRef.current === "paused") {
        await wait(80);
      }
      if (paintControlRef.current === "stopped") {
        updatePaintSession(sessionId, (session) => ({ ...session, status: "stopped" }), true);
        setBusyAction(null);
        return;
      }

      const action = initialSession.actions[index];
      const layer = buildLayerFromAssistAction(action, workingDocument);
      if (layer) {
        workingDocument = { ...workingDocument, layers: [...workingDocument.layers, layer] };
        lastLayerId = layer.id;
      }

      if ((index + 1) % 8 === 0 || index === initialSession.actions.length - 1) {
        const completedActionCount = index + 1;
        workingDocument = {
          ...workingDocument,
          paintSessions: (workingDocument.paintSessions || []).map((session) => session.id === sessionId
            ? { ...session, completedActionCount, status: completedActionCount === session.actions.length ? "complete" : "painting" }
            : session),
        };
        documentRef.current = workingDocument;
        setDocument(workingDocument);
        setSelectedLayerIds(lastLayerId ? [lastLayerId] : []);
        setSelectedLayerId(lastLayerId);
        await wait(12);
      }
    }

    commitDocument(workingDocument, { selectedLayerId: lastLayerId, selectedLayerIds: lastLayerId ? [lastLayerId] : [] });
    setAssistantCursor(null);
    setBusyAction(null);
  }

  async function startReferencePainting() {
    if (!paintReferenceAsset) {
      toast.error("Choose a reference from the image library first.");
      return;
    }
    setBusyAction("paint");
    try {
      const actions = await buildReferencePaintingPlan({
        imageUrl: paintReferenceAsset.imageUrl,
        canvas: documentRef.current,
        detailLevel: paintDetailLevel,
      });
      const session: EditorPaintSession = {
        id: createId("paint"),
        referenceAssetId: paintReferenceAsset.id,
        referenceTitle: paintReferenceAsset.title,
        detailLevel: paintDetailLevel,
        actions,
        completedActionCount: 0,
        status: "ready",
        createdAt: new Date().toISOString(),
      };
      commitDocument({ ...documentRef.current, paintSessions: [...(documentRef.current.paintSessions || []), session] });
      await replayPaintSession(session.id);
    } catch (error) {
      setBusyAction(null);
      toast.error(error instanceof Error ? error.message : "Unable to prepare the reference for painting.");
    }
  }

  function pausePainting() {
    if (!activePaintSessionId) return;
    paintControlRef.current = "paused";
    updatePaintSession(activePaintSessionId, (session) => ({ ...session, status: "paused" }), true);
  }

  function resumePainting() {
    if (!activePaintSessionId) return;
    const session = documentRef.current.paintSessions?.find((item) => item.id === activePaintSessionId);
    if (!session || session.status === "complete") return;
    paintControlRef.current = "running";
    updatePaintSession(activePaintSessionId, (session) => ({ ...session, status: "painting" }));
    if (busyAction !== "paint") void replayPaintSession(activePaintSessionId);
  }

  function stopPainting() {
    paintControlRef.current = "stopped";
    if (activePaintSessionId) {
      updatePaintSession(activePaintSessionId, (session) => ({ ...session, status: "stopped" }), true);
    }
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

      if (activeProjectId && isLocalEditorProjectId(activeProjectId)) {
        const project = saveProjectLocally({
          projectId: activeProjectId,
          name: body.name,
          canvas: body.canvas,
          previewUrl,
        });
        setActiveProjectId(project.id);
        setProjectName(project.name);
        setProjects((current) => mergeProjectSummaries(current, [summarizeProject(project)]));
        toast.success("Project saved on this device.", { id: toastId });
        return;
      }

      const remoteProject = await saveProjectRemotely(activeProjectId, body);
      if (remoteProject) {
        setActiveProjectId(remoteProject.id);
        setProjectName(remoteProject.name);
        setProjects((current) => mergeProjectSummaries(current, [summarizeProject(remoteProject)]));
        toast.success("Project saved.", { id: toastId });
        return;
      }

      const localProject = saveProjectLocally({
        projectId: activeProjectId,
        name: body.name,
        canvas: body.canvas,
        previewUrl,
      });
      setActiveProjectId(localProject.id);
      setProjectName(localProject.name);
      setProjects((current) => mergeProjectSummaries(current, [summarizeProject(localProject)]));
      toast.success("Project saved on this device.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Project save failed.", { id: toastId });
    } finally {
      setBusyAction(null);
    }
  }

  async function saveProjectRemotely(activeId: string | null, body: { name: string; canvas: EditorCanvasDocument; previewUrl: string | null }) {
    if (!activeId) {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.project) {
        return null;
      }
      return data.project as EditorProjectDetail;
    }

    const response = await fetch(`/api/projects/${activeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.ok && data?.project) {
      return data.project as EditorProjectDetail;
    }

    if (data?.error === "Project not found.") {
      const createResponse = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const createData = await createResponse.json().catch(() => null);
      if (createResponse.ok && createData?.ok && createData?.project) {
        return createData.project as EditorProjectDetail;
      }
    }

    return null;
  }

  function saveProjectLocally(input: { projectId: string | null; name: string; canvas: EditorCanvasDocument; previewUrl: string | null }) {
    const currentProjects = readLocalEditorProjects();
    const id = isLocalEditorProjectId(input.projectId) ? input.projectId : `local-${createId("project")}`;
    const existing = currentProjects.find((project) => project.id === id);
    const project: EditorProjectDetail = {
      id,
      name: input.name,
      canvas: input.canvas,
      // PNG data URLs quickly exhaust localStorage. Remote projects retain previews;
      // device-only recovery saves keep the editable document instead.
      previewUrl: null,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    writeLocalEditorProjects([
      project,
      ...currentProjects.filter((item) => item.id !== project.id),
    ]);

    return project;
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
      if (isLocalEditorProjectId(projectId)) {
        const localProject = readLocalEditorProjects().find((project) => project.id === projectId);
        if (!localProject) {
          throw new Error("Local project not found.");
        }
        setActiveProjectId(localProject.id);
        setProjectName(localProject.name);
        resetDocument(localProject.canvas);
        setProjects((current) => mergeProjectSummaries(current, [summarizeProject(localProject)]));
        toast.success("Local project loaded.", { id: toastId });
        return;
      }

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

  function setManualZoom(nextZoom: number) {
    isManualZoomRef.current = true;
    setZoom(Number(Math.min(2, Math.max(0.18, nextZoom)).toFixed(3)));
  }

  function fitCanvasToViewport() {
    if (!canvasViewport.width || !canvasViewport.height) return;
    isManualZoomRef.current = false;
    const fitZoom = Math.min(
      (canvasViewport.width - 32) / document.width,
      (canvasViewport.height - 32) / document.height,
      1
    );
    setZoom(Number(Math.max(0.18, fitZoom).toFixed(3)));
  }

  function commitCanvasDimension(axis: "width" | "height") {
    const input = axis === "width" ? canvasWidthInput : canvasHeightInput;
    const currentValue = axis === "width" ? document.width : document.height;
    const parsedValue = Number(input);
    if (!input.trim() || !Number.isFinite(parsedValue)) {
      if (axis === "width") setCanvasWidthInput(String(currentValue));
      else setCanvasHeightInput(String(currentValue));
      return;
    }
    const nextValue = Math.max(24, Math.min(6000, Math.round(parsedValue)));
    if (nextValue !== currentValue) {
      mutateDocument((current) => ({ ...current, [axis]: nextValue }));
      isManualZoomRef.current = false;
    }
    if (axis === "width") setCanvasWidthInput(String(nextValue));
    else setCanvasHeightInput(String(nextValue));
  }

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
                <div className="inline-flex items-center rounded-full border border-yellow-300 bg-yellow-50 px-2 py-1 text-sm font-medium text-yellow-900">
                  <input
                    aria-label="Canvas width"
                    type="number"
                    min={24}
                    max={6000}
                    value={canvasWidthInput}
                    onChange={(event) => setCanvasWidthInput(event.target.value)}
                    onBlur={() => commitCanvasDimension("width")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="w-14 bg-transparent text-center outline-none"
                  />
                  <span aria-hidden="true">x</span>
                  <input
                    aria-label="Canvas height"
                    type="number"
                    min={24}
                    max={6000}
                    value={canvasHeightInput}
                    onChange={(event) => setCanvasHeightInput(event.target.value)}
                    onBlur={() => commitCanvasDimension("height")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="w-14 bg-transparent text-center outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setManualZoom(zoom - 0.1)} className="rounded-full border border-pink-200 bg-white px-3 py-1.5 text-sm text-pink-700">-</button>
                <span className="min-w-[70px] text-center text-sm font-medium text-pink-700">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setManualZoom(zoom + 0.1)} className="rounded-full border border-pink-200 bg-white px-3 py-1.5 text-sm text-pink-700">+</button>
                <button type="button" onClick={fitCanvasToViewport} className="rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm text-yellow-900">Fit</button>
              </div>
            </div>

            <div ref={canvasViewportRef} className="h-[min(74vh,780px)] min-h-[360px] overflow-auto rounded-[1.5rem] border border-pink-100 bg-[linear-gradient(135deg,_rgba(255,250,214,0.5),_rgba(255,241,247,0.8))] p-4">
              <div className="flex min-h-full min-w-full items-center justify-center">
                <div style={{ width: canvasWidth, height: canvasHeight }}>
                <Stage
                  ref={stageRef}
                  width={canvasWidth}
                  height={canvasHeight}
                  onMouseDown={handleStageMouseDown}
                  onMouseMove={handleStageMouseMove}
                  onMouseUp={handleStageMouseUp}
                  className="rounded-[1.25rem] bg-white shadow-[0_16px_40px_rgba(255,199,223,0.4)]"
                >
                  <Layer>
                    <Group scaleX={zoom} scaleY={zoom}>
                    <Rect width={document.width} height={document.height} fill={document.backgroundColor} listening={false} />
                    {document.layers.map((layer) => renderLayer({
                      layer,
                      isSelected: selectedLayerIds.includes(layer.id),
                      onSelect: (event) => {
                        if (tool !== "select") {
                          setSelection([layer.id], layer.id);
                          return;
                        }
                        if (event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey) {
                          const nextIds = selectedLayerIds.includes(layer.id)
                            ? selectedLayerIds.filter((id) => id !== layer.id)
                            : [...selectedLayerIds, layer.id];
                          setSelection(nextIds, layer.id);
                          return;
                        }
                        setSelection([layer.id], layer.id);
                      },
                      onDragStart: () => beginSelectionDrag(layer.id),
                      onDragMove: (x, y) => dragSelection(layer.id, x, y),
                      onDragEnd: (x, y) => endSelectionDrag(layer.id, x, y),
                      onTransformEnd: () => handleTransformEnd(layer.id),
                      onDoubleClick: () => handleTextEdit(layer.id),
                      nodeRefs,
                    }))}
                    {selectionRect ? (
                      <Rect
                        x={selectionRect.x}
                        y={selectionRect.y}
                        width={selectionRect.width}
                        height={selectionRect.height}
                        stroke="#ff8a5b"
                        dash={[10, 8]}
                        fill="rgba(255,138,91,0.12)"
                      />
                    ) : null}
                    {lassoPoints.length >= 4 ? (
                      <Line
                        points={lassoPoints}
                        closed
                        stroke="#ff8a5b"
                        dash={[10, 8]}
                        fill="rgba(255,138,91,0.08)"
                        strokeWidth={3}
                      />
                    ) : null}
                    {multiSelectionBounds ? (
                      <Rect
                        x={multiSelectionBounds.x}
                        y={multiSelectionBounds.y}
                        width={multiSelectionBounds.width}
                        height={multiSelectionBounds.height}
                        stroke="#ff5fb2"
                        dash={[12, 10]}
                        strokeWidth={3}
                        fill="rgba(255,95,178,0.04)"
                        draggable={tool === "select"}
                        onDragStart={handleSelectionBoundsDragStart}
                        onDragMove={(event) => handleSelectionBoundsDragMove(event.target.x(), event.target.y())}
                        onDragEnd={(event) => handleSelectionBoundsDragEnd(event.target.x(), event.target.y())}
                      />
                    ) : null}
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
                    </Group>
                  </Layer>
                </Stage>
                  </div>
              </div>
            </div>
          </section>

          <aside className="rounded-[1.8rem] border border-pink-200/80 bg-white/82 p-4 shadow-[0_18px_60px_rgba(255,129,181,0.16)] backdrop-blur">
            <div className="space-y-4">
              <details open className="rounded-[1.4rem] border border-pink-100 bg-pink-50/60 p-4">
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-[#7a1f4f]">
                  <span>Layers</span>
                  <span className="rounded-full border border-pink-200 bg-white px-2 py-0.5 text-xs font-medium text-pink-600">{document.layers.length}</span>
                </summary>
                <div className="mt-3 max-h-[min(44vh,30rem)] space-y-2 overflow-y-auto overscroll-contain pr-1">
                  {[...document.layers].reverse().map((layer) => (
                    <div key={layer.id} className={selectedLayerIds.includes(layer.id) ? "rounded-[1rem] border border-pink-300 bg-white p-3" : "rounded-[1rem] border border-pink-100 bg-white/80 p-3"}>
                      <button type="button" onClick={() => setSelection([layer.id], layer.id)} className="w-full text-left text-sm font-medium text-[#6d2141]">
                        {layer.name}
                      </button>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <button type="button" onClick={() => moveLayer(layer.id, "up")} className="rounded-full border border-yellow-300 bg-yellow-50 px-2 py-1 text-yellow-900">Up</button>
                        <button type="button" onClick={() => moveLayer(layer.id, "down")} className="rounded-full border border-yellow-300 bg-yellow-50 px-2 py-1 text-yellow-900">Down</button>
                        <button type="button" onClick={() => setSelection(selectedLayerIds.includes(layer.id) ? selectedLayerIds.filter((id) => id !== layer.id) : [...selectedLayerIds, layer.id], layer.id)} className="rounded-full border border-pink-200 bg-pink-50 px-2 py-1 text-pink-700">{selectedLayerIds.includes(layer.id) ? "Deselect" : "Add"}</button>
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
                  <AssetShelf title="Uploads" assets={groupedAssets.upload} onInsert={insertAssetAsLayer} onChooseReference={setPaintReferenceAssetId} selectedReferenceId={paintReferenceAssetId} />
                  <AssetShelf title="Generated" assets={groupedAssets.generated} onInsert={insertAssetAsLayer} onChooseReference={setPaintReferenceAssetId} selectedReferenceId={paintReferenceAssetId} />
                  <AssetShelf title="Edited" assets={groupedAssets.edited} onInsert={insertAssetAsLayer} onChooseReference={setPaintReferenceAssetId} selectedReferenceId={paintReferenceAssetId} />
                </div>
              </details>

              <details open className="rounded-[1.4rem] border border-pink-100 bg-pink-50/60 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#7a1f4f]">AI Painter</summary>
                <div className="mt-3 space-y-3 text-sm text-pink-700">
                  <p className="text-xs leading-5 text-pink-600">Choose a library image as a reference, then paint it with replayable Easel brush strokes.</p>
                  <p className="truncate rounded-lg border border-pink-100 bg-white px-3 py-2 text-xs font-medium text-[#6d2141]">{paintReferenceAsset ? `Reference: ${paintReferenceAsset.title}` : "No reference selected"}</p>
                  <label className="block">
                    Detail level
                    <select value={paintDetailLevel} onChange={(event) => setPaintDetailLevel(event.target.value as EditorPaintDetailLevel)} className="mt-1 w-full rounded-lg border border-pink-200 bg-white px-3 py-2 text-sm">
                      <option value="study">Study</option>
                      <option value="refined">Refined</option>
                      <option value="high-detail">High detail</option>
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void startReferencePainting()} disabled={busyAction !== null} className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Paint reference</button>
                    <button type="button" onClick={pausePainting} disabled={busyAction !== "paint" || activePaintSession?.status !== "painting"} className="rounded-full border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm font-medium text-yellow-900 disabled:opacity-50">Pause</button>
                    <button type="button" onClick={resumePainting} disabled={!activePaintSession || !["paused", "stopped"].includes(activePaintSession.status)} className="rounded-full border border-pink-200 bg-white px-3 py-2 text-sm font-medium text-pink-700 disabled:opacity-50">Resume</button>
                    <button type="button" onClick={stopPainting} disabled={busyAction !== "paint"} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-50">Stop</button>
                  </div>
                  {activePaintSession ? <p className="text-xs text-pink-500">{activePaintSession.status} · {activePaintSession.completedActionCount} of {activePaintSession.actions.length} strokes</p> : null}
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
                    placeholder="Write on the board, explain a topic, highlight something, circle a layer, point at an object, brush a mark, or erase a region."
                    className="min-h-[150px] w-full rounded-[1.25rem] border border-pink-200 bg-white px-4 py-3 text-sm text-[#6d2141] outline-none placeholder:text-pink-300"
                  />
                  <div>
                    <button type="button" onClick={() => void runAi("generate")} disabled={busyAction !== null} className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                      {busyAction === "generate" ? "Running..." : "Run on easel"}
                    </button>
                  </div>
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
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: () => void;
  onDragMove: (x: number, y: number) => void;
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
    onDragStart: input.onDragStart,
    onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => input.onDragMove(event.target.x(), event.target.y()),
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
    const isPaintTile = /^Underpainting region\b/i.test(input.layer.name);
    return (
      <Group {...commonProps}>
        <Rect width={input.layer.width} height={input.layer.height} fill={input.layer.fill} stroke={input.layer.stroke} strokeWidth={input.layer.strokeWidth} cornerRadius={isPaintTile ? 0 : 18} />
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

function AssetShelf({ title, assets, onInsert, onChooseReference, selectedReferenceId }: { title: string; assets: EditorAsset[]; onInsert: (asset: EditorAsset) => void; onChooseReference: (assetId: string) => void; selectedReferenceId: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-500">{title}</p>
      <div className="mt-2 max-h-[24rem] space-y-2 overflow-y-auto pr-1">
        {assets.length ? assets.map((asset) => (
          <div key={asset.id} className={selectedReferenceId === asset.id ? "flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-[1rem] border border-pink-400 bg-pink-50 p-2" : "flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-[1rem] border border-pink-100 bg-white p-2"}>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[radial-gradient(circle_at_top,_rgba(255,236,171,0.9),_rgba(255,246,250,0.95)_58%,_rgba(255,255,255,0.98)_100%)] p-1.5">
              <img src={asset.imageUrl} alt={asset.title} className="max-h-full w-full rounded-lg object-contain" />
            </div>
            <span className="min-w-0 flex-1 overflow-hidden text-sm leading-5 text-[#6d2141]">
              <span className="block truncate font-medium">{asset.title}</span>
              <span className="block truncate text-xs text-pink-500">Reference or canvas image</span>
            </span>
            <div className="flex shrink-0 flex-col gap-1">
              <button type="button" onClick={() => onChooseReference(asset.id)} className="rounded-full border border-pink-200 bg-white px-2 py-1 text-xs font-medium text-pink-700">Reference</button>
              <button type="button" onClick={() => onInsert(asset)} className="rounded-full border border-yellow-300 bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-900">Place</button>
            </div>
          </div>
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
  return stage.toDataURL({ pixelRatio: 2 / Math.max(zoom, 0.01), mimeType });
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

function readLocalEditorProjects() {
  if (typeof window === "undefined") {
    return [] as EditorProjectDetail[];
  }

  try {
    const stored = window.localStorage.getItem(LOCAL_EDITOR_PROJECTS_STORAGE_KEY);
    if (!stored) {
      return [] as EditorProjectDetail[];
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [] as EditorProjectDetail[];
    }

    return parsed
      .map((project) => normalizeStoredEditorProject(project))
      .filter(Boolean) as EditorProjectDetail[];
  } catch {
    return [] as EditorProjectDetail[];
  }
}

function writeLocalEditorProjects(projects: EditorProjectDetail[]) {
  if (typeof window === "undefined") {
    return;
  }

  const compactProjects = projects.slice(0, 6).map((project) => ({
    ...project,
    previewUrl: null,
  }));

  try {
    window.localStorage.setItem(LOCAL_EDITOR_PROJECTS_STORAGE_KEY, JSON.stringify(compactProjects));
  } catch (error) {
    if (!isStorageQuotaError(error)) {
      throw error;
    }

    // Clear legacy entries that included large canvas PNG previews, then retry
    // with only the most recent editable project.
    try {
      window.localStorage.removeItem(LOCAL_EDITOR_PROJECTS_STORAGE_KEY);
      window.localStorage.setItem(LOCAL_EDITOR_PROJECTS_STORAGE_KEY, JSON.stringify(compactProjects.slice(0, 1)));
    } catch (retryError) {
      if (isStorageQuotaError(retryError)) {
        throw new Error("This canvas is too large to save locally. Save a smaller canvas or reconnect project storage.");
      }
      throw retryError;
    }
  }
}

function normalizeStoredEditorProject(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!record) return null;

  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Untitled project";
  if (!id) return null;

  return {
    id,
    name,
    previewUrl: typeof record.previewUrl === "string" ? record.previewUrl : null,
    canvas: deserializeDocument(serializeDocument(record.canvas ?? createEmptyEditorDocument())),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
  } satisfies EditorProjectDetail;
}

function mergeProjectSummaries(current: EditorProjectSummary[], incoming: EditorProjectSummary[]) {
  const merged = [...incoming, ...current];
  const seen = new Set<string>();
  return merged.filter((project) => {
    if (seen.has(project.id)) {
      return false;
    }
    seen.add(project.id);
    return true;
  }).slice(0, 24);
}

function isLocalEditorProjectId(projectId: string | null | undefined) {
  return Boolean(projectId && projectId.startsWith("local-"));
}

function isStorageQuotaError(error: unknown) {
  const name = String((error as { name?: unknown } | null)?.name || "");
  const message = error instanceof Error ? error.message : String(error || "");
  return name === "QuotaExceededError" || /exceeded the quota|quota exceeded/i.test(message);
}

function resolveLayerSelection(document: EditorCanvasDocument, selectedLayerIds: string[], selectedLayerId: string | null | undefined) {
  const validIds = Array.from(new Set(selectedLayerIds)).filter((id) => document.layers.some((layer) => layer.id === id));
  const nextPrimaryId = selectedLayerId && validIds.includes(selectedLayerId)
    ? selectedLayerId
    : validIds[validIds.length - 1] ?? null;

  if (!nextPrimaryId) {
    return {
      selectedLayerId: null,
      selectedLayerIds: [],
    };
  }

  const nextIds = validIds.length ? validIds : [nextPrimaryId];
  return {
    selectedLayerId: nextPrimaryId,
    selectedLayerIds: nextIds,
  };
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

function getLayerBounds(layer: EditorLayer) {
  if (layer.kind === "line") {
    const points = layer.points;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < points.length - 1; index += 2) {
      minX = Math.min(minX, points[index]);
      minY = Math.min(minY, points[index + 1]);
      maxX = Math.max(maxX, points[index]);
      maxY = Math.max(maxY, points[index + 1]);
    }
    const padding = Math.max(8, layer.strokeWidth / 2);
    return {
      x: minX - padding,
      y: minY - padding,
      width: Math.max(1, maxX - minX + padding * 2),
      height: Math.max(1, maxY - minY + padding * 2),
    };
  }

  return {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
  };
}

function getCombinedLayerBounds(layers: EditorLayer[]) {
  if (!layers.length) return null;
  const bounds = layers.map(getLayerBounds);
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function collectLayersInRect(layers: EditorLayer[], rect: EditorCropRect) {
  return layers.filter((layer) => intersectsRect(getLayerBounds(layer), rect));
}

function collectLayersInLasso(layers: EditorLayer[], points: number[]) {
  if (points.length < 6) return [];
  return layers.filter((layer) => {
    const bounds = getLayerBounds(layer);
    const samplePoints = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    ];
    return samplePoints.some((point) => pointInPolygon(point, points));
  });
}

function intersectsRect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

function pointInPolygon(point: { x: number; y: number }, polygon: number[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 2; index < polygon.length; index += 2) {
    const xi = polygon[index];
    const yi = polygon[index + 1];
    const xj = polygon[previous];
    const yj = polygon[previous + 1];
    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-6) + xi;
    if (intersects) {
      inside = !inside;
    }
    previous = index;
  }
  return inside;
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
      opacity: Number.isFinite(Number(action.opacity)) ? Math.max(0.05, Math.min(1, Number(action.opacity))) : 1,
      text,
      fill: String(action.color || "#7a1f4f"),
      fontSize: Math.max(18, Math.round(Number(action.fontSize || 42))),
      fontFamily: /^(?:Math title|Math working)$/i.test(String(action.label || ""))
        ? "Cambria Math, STIX Two Math, Cambria, serif"
        : "Manrope",
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
      opacity: Number.isFinite(Number(action.opacity)) ? Math.max(0.05, Math.min(1, Number(action.opacity))) : 1,
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
      opacity: Number.isFinite(Number(action.opacity)) ? Math.max(0.05, Math.min(1, Number(action.opacity))) : 1,
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

function shouldIgnoreEditorShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function buildLocalCanvasFallbackPlan(
  prompt: string,
  selectedLayer: EditorAssistSelectedLayer | null,
  document: EditorCanvasDocument
): EditorAssistPlan {
  const lower = prompt.toLowerCase();
  const target = getAssistTargetBounds(document, selectedLayer);

  if (isExplanationFallbackPrompt(prompt)) {
    return buildExplanationAssistPlan(document, extractExplanationFallbackTopic(prompt) || "this topic", prompt);
  }

  if (isMathFallbackPrompt(prompt)) {
    const mathPlan = buildLocalMathAssistPlan(prompt, document);
    if (mathPlan) return mathPlan;
  }

  if (/flower/.test(lower)) {
    return {
      mode: "canvas",
      assistantMessage: "Sketching a flower with easel tools.",
      actions: buildFlowerAssistActions(document),
    };
  }

  if (/heart/.test(lower)) {
    return {
      mode: "canvas",
      assistantMessage: "Sketching a heart with easel tools.",
      actions: buildHeartAssistActions(document),
    };
  }

  if (/sun/.test(lower)) {
    return {
      mode: "canvas",
      assistantMessage: "Sketching a sun with easel tools.",
      actions: buildSunAssistActions(document),
    };
  }

  if (/\b(car|automobile|vehicle|sedan)\b/.test(lower)) {
    return {
      mode: "canvas",
      assistantMessage: "Doodling a car with easel tools.",
      actions: buildCarAssistActions(document),
    };
  }

  if (/\b(barn|farmhouse|stable)\b/.test(lower)) {
    return {
      mode: "canvas",
      assistantMessage: "Sketching a barn with easel tools.",
      actions: buildBarnAssistActions(document),
    };
  }

  if (/\b(building|skyscraper|office|tower|apartment)\b/.test(lower)) {
    return {
      mode: "canvas",
      assistantMessage: "Doodling a building with easel tools.",
      actions: buildBuildingAssistActions(document),
    };
  }

  if (/\b(motorcycle|motorbike|bike)\b/.test(lower)) {
    return {
      mode: "canvas",
      assistantMessage: "Doodling a motorcycle with easel tools.",
      actions: buildMotorcycleAssistActions(document),
    };
  }

  if (selectedLayer && /(highlight|box|outline|frame)/.test(lower)) {
    return {
      mode: "canvas",
      assistantMessage: "Highlighting the selection on the easel.",
      actions: [{
        tool: "rect",
        label: "Highlight",
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        stroke: "#ff5fb2",
        fill: "rgba(255,95,178,0.14)",
        strokeWidth: 6,
      }],
    };
  }

  if (selectedLayer && /(circle|oval|encircle|ring around)/.test(lower)) {
    return {
      mode: "canvas",
      assistantMessage: "Circling the selection on the easel.",
      actions: [{
        tool: "ellipse",
        label: "Circle",
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        stroke: "#ff5fb2",
        fill: "rgba(255,95,178,0.08)",
        strokeWidth: 5,
      }],
    };
  }

  if (selectedLayer && /(point|arrow|call out)/.test(lower)) {
    const centerX = target.x + target.width / 2;
    const centerY = target.y + target.height / 2;
    return {
      mode: "canvas",
      assistantMessage: "Pointing to the selection on the easel.",
      actions: [{
        tool: "arrow",
        label: "Arrow",
        points: buildArrowAssistPoints(target.x - 80, target.y - 50, centerX, centerY),
        stroke: "#ff8a5b",
        strokeWidth: 8,
      }],
    };
  }

  if (selectedLayer && /(underline|line under|mark beneath)/.test(lower)) {
    const y = Math.min(document.height - 8, target.y + target.height + 16);
    return {
      mode: "canvas",
      assistantMessage: "Underlining the selection on the easel.",
      actions: [{
        tool: "brush",
        label: "Underline",
        points: [target.x, y, target.x + target.width * 0.4, y + 1, target.x + target.width, y],
        stroke: "#ff8a5b",
        strokeWidth: 10,
      }],
    };
  }

  if (selectedLayer && /(erase|remove|clear)/.test(lower)) {
    const centerY = target.y + target.height / 2;
    return {
      mode: "canvas",
      assistantMessage: "Erasing across the selection on the easel.",
      actions: [{
        tool: "eraser",
        label: "Erase",
        points: [target.x, centerY, target.x + target.width * 0.5, centerY - 4, target.x + target.width, centerY + 2],
        strokeWidth: Math.max(20, Math.round(target.height * 0.24)),
      }],
    };
  }

  if (/\b(?:draw|doodle|sketch|paint|make|create|illustrate)\b/.test(lower)) {
    return buildStructuredIllustrationPlan(prompt, document);
  }

  return buildStructuredIllustrationPlan(prompt, document);
}

function buildExplanationAssistPlan(document: EditorCanvasDocument, topic: string, prompt: string): EditorAssistPlan {
  const normalizedTopic = toDisplayFallbackTopic(topic);
  const explanation = buildDeterministicExplanationSections(topic);
  const bodyLines = wrapFallbackText([explanation.summary, ...explanation.keyPoints.map((point) => `• ${point}`)].join(" "), 62);
  const width = Math.max(340, Math.min(document.width - 80, 760));
  const cardHeight = Math.max(176, 94 + bodyLines.length * 30);
  const placement = resolveFallbackPlacement(document, prompt, width, cardHeight);
  const x = placement.x;
  const y = placement.y;

  const actions: EditorAssistAction[] = [
    {
      tool: "rect",
      label: "Explanation card",
      x,
      y,
      width,
      height: cardHeight,
      stroke: "#ff8a5b",
      fill: "rgba(255,248,220,0.78)",
      strokeWidth: 4,
    },
    {
      tool: "text",
      label: "Explanation title",
      text: normalizedTopic,
      x: x + 24,
      y: y + 22,
      width: width - 48,
      fontSize: 34,
      color: "#7a1f4f",
    },
    {
      tool: "text",
      label: "Explanation",
      text: bodyLines.join("\n"),
      x: x + 24,
      y: y + 78,
      width: width - 48,
      fontSize: 24,
      color: "#5f2141",
    },
  ];

  return {
    mode: "canvas",
    assistantMessage: `Writing an explanation about ${topic}.`,
    actions,
  };
}

function buildLocalMathAssistPlan(prompt: string, document: EditorCanvasDocument): EditorAssistPlan | null {
  const compact = prompt.replace(/\s+/g, " ").trim();
  const linear = compact.match(/(?:solve\s*)?([+-]?\s*\d*)\s*x\s*([+-]\s*\d+)?\s*=\s*([+-]?\s*\d+(?:\.\d+)?)/i);
  let title = "Math working";
  let result = "Use the equation and substitute the supplied values.";
  let steps = ["Write the relevant formula clearly.", "Substitute the known values and simplify one operation at a time."];

  if (linear) {
    const coefficientText = linear[1].replace(/\s/g, "");
    const coefficient = coefficientText === "" || coefficientText === "+" ? 1 : coefficientText === "-" ? -1 : Number(coefficientText);
    const constant = Number((linear[2] || "0").replace(/\s/g, ""));
    const rightSide = Number(linear[3]);
    if (Number.isFinite(coefficient) && coefficient !== 0 && Number.isFinite(constant) && Number.isFinite(rightSide)) {
      const numerator = rightSide - constant;
      const value = numerator / coefficient;
      title = "Solve for x";
      result = `x = ${Number.isInteger(value) ? value : Number(value.toFixed(4))}`;
      steps = [
        `Subtract ${constant} from both sides: ${coefficient}x = ${numerator}.`,
        `Divide both sides by ${coefficient}.`,
      ];
    }
  } else if (/fundamental theorem of calculus|\bftc\b|definite integral/i.test(compact)) {
    title = "Fundamental Theorem of Calculus";
    result = "∫ₐᵇ f(x) dx = F(b) − F(a), where F′(x) = f(x).";
    steps = ["Find an antiderivative F(x).", "Evaluate the endpoints: F(b) − F(a).", "Example: ∫₀² 3x² dx = [x³]₀² = 8."];
  } else if (/\b(?:summation|sum|series)\b/i.test(compact)) {
    title = "Summation setup";
    result = "Use ∑ₖ₌₁ⁿ to add terms from k = 1 through n.";
    steps = ["Write the general term as a function of k.", "Set the lower and upper bounds on ∑.", "For example, ∑ₖ₌₁ⁿ k = n(n + 1)/2."];
  } else if (/\b(?:derivative|differentiate|integral|integrate|calculus|limit)\b/i.test(compact)) {
    title = "Calculus setup";
    result = "Power rule: d/dx[xⁿ] = n·xⁿ⁻¹.";
    steps = ["Apply the rule to each term separately.", "For integrals, use ∫ f(x) dx and add C for an indefinite integral.", "Simplify the resulting expression."];
  } else if (/\b(?:elasticity|supply|demand|revenue|cost|profit|marginal)\b/i.test(compact)) {
    title = "Economics calculation setup";
    result = "Choose the relevant relationship and substitute the provided values.";
    steps = ["Profit: π = TR − TC. Marginal revenue: MR = dTR/dQ.", "Elasticity: Eₚ = (%∆Q)/(%∆P).", "Compute the value and interpret its sign and units."];
  } else {
    return null;
  }

  const bodyLines = wrapFallbackText([`Result: ${result}`, ...steps.map((step, index) => `${index + 1}. ${step}`)].join(" "), 64);
  const width = Math.max(340, Math.min(document.width - 80, 820));
  const height = Math.max(190, 98 + bodyLines.length * 30);
  const placement = resolveFallbackPlacement(document, prompt, width, height);
  return {
    mode: "canvas",
    assistantMessage: `Working through ${title.toLowerCase()}.`,
    actions: [
      { tool: "rect", label: "Math solution box", x: placement.x, y: placement.y, width, height, stroke: "#4d8cff", fill: "rgba(226,242,255,0.88)", strokeWidth: 4 },
      { tool: "text", label: "Math title", text: title, x: placement.x + 24, y: placement.y + 22, width: width - 48, fontSize: 34, color: "#174a8b" },
      { tool: "text", label: "Math working", text: bodyLines.join("\n"), x: placement.x + 24, y: placement.y + 80, width: width - 48, fontSize: 24, color: "#15385f" },
    ],
  };
}

function buildFlowerAssistActions(document: EditorCanvasDocument): EditorAssistAction[] {
  const centerX = document.width * 0.5;
  const centerY = document.height * 0.42;
  const offsets = [
    { x: -56, y: -10 },
    { x: 10, y: -56 },
    { x: 76, y: -10 },
    { x: 10, y: 36 },
  ];
  return [
    ...offsets.map((offset, index) => ({
      tool: "ellipse" as const,
      label: `Petal ${index + 1}`,
      x: centerX + offset.x,
      y: centerY + offset.y,
      width: 96,
      height: 64,
      stroke: "#ff5fb2",
      fill: "rgba(255,182,214,0.42)",
      strokeWidth: 4,
    })),
    {
      tool: "ellipse",
      label: "Flower center",
      x: centerX + 14,
      y: centerY + 8,
      width: 48,
      height: 48,
      stroke: "#ffb200",
      fill: "rgba(255,214,82,0.75)",
      strokeWidth: 4,
    },
    {
      tool: "brush",
      label: "Stem",
      points: [centerX + 38, centerY + 54, centerX + 30, centerY + 126, centerX + 24, centerY + 188],
      stroke: "#2ca24f",
      strokeWidth: 10,
    },
  ];
}

function buildHeartAssistActions(document: EditorCanvasDocument): EditorAssistAction[] {
  const centerX = document.width * 0.5;
  const centerY = document.height * 0.38;
  return [{
    tool: "brush",
    label: "Heart",
    points: [centerX, centerY + 110, centerX - 92, centerY + 20, centerX - 54, centerY - 48, centerX, centerY - 2, centerX + 54, centerY - 48, centerX + 92, centerY + 20, centerX, centerY + 110],
    stroke: "#ff5fb2",
    strokeWidth: 10,
  }];
}

function buildSunAssistActions(document: EditorCanvasDocument): EditorAssistAction[] {
  const centerX = document.width * 0.5;
  const centerY = document.height * 0.34;
  return [
    {
      tool: "ellipse",
      label: "Sun",
      x: centerX - 54,
      y: centerY - 54,
      width: 108,
      height: 108,
      stroke: "#ffb200",
      fill: "rgba(255,214,82,0.55)",
      strokeWidth: 5,
    },
    {
      tool: "brush",
      label: "Rays",
      points: [centerX, centerY - 92, centerX, centerY - 132, centerX + 62, centerY - 62, centerX + 90, centerY - 90, centerX + 92, centerY, centerX + 132, centerY, centerX + 62, centerY + 62, centerX + 90, centerY + 90, centerX, centerY + 92, centerX, centerY + 132, centerX - 62, centerY + 62, centerX - 90, centerY + 90, centerX - 92, centerY, centerX - 132, centerY, centerX - 62, centerY - 62, centerX - 90, centerY - 90],
      stroke: "#ffb200",
      strokeWidth: 6,
    },
  ];
}

function buildCarAssistActions(document: EditorCanvasDocument): EditorAssistAction[] {
  const centerX = document.width * 0.5;
  const centerY = document.height * 0.4;
  const bodyWidth = 260;
  const bodyHeight = 88;
  const wheelSize = 58;
  const bodyX = centerX - bodyWidth / 2;
  const bodyY = centerY;
  const wheelY = bodyY + bodyHeight - wheelSize * 0.42;
  const leftWheelX = bodyX + bodyWidth * 0.18;
  const rightWheelX = bodyX + bodyWidth * 0.66;
  return [
    { tool: "rect", label: "Car body", x: bodyX, y: bodyY, width: bodyWidth, height: bodyHeight, stroke: "#e84a5f", fill: "rgba(232,74,95,0.22)", strokeWidth: 5 },
    { tool: "brush", label: "Car roof", points: [bodyX + bodyWidth * 0.22, bodyY, bodyX + bodyWidth * 0.36, bodyY - 76, bodyX + bodyWidth * 0.68, bodyY - 76, bodyX + bodyWidth * 0.82, bodyY], stroke: "#e84a5f", strokeWidth: 6 },
    { tool: "brush", label: "Bumper", points: [bodyX + 12, bodyY + bodyHeight * 0.72, bodyX - 12, bodyY + bodyHeight * 0.76, bodyX + 12, bodyY + bodyHeight * 0.84], stroke: "#ffb200", strokeWidth: 5 },
    { tool: "ellipse", label: "Left wheel", x: leftWheelX, y: wheelY, width: wheelSize, height: wheelSize, stroke: "#3d4655", fill: "rgba(61,70,85,0.3)", strokeWidth: 5 },
    { tool: "ellipse", label: "Right wheel", x: rightWheelX, y: wheelY, width: wheelSize, height: wheelSize, stroke: "#3d4655", fill: "rgba(61,70,85,0.3)", strokeWidth: 5 },
    { tool: "ellipse", label: "Left hub", x: leftWheelX + 19, y: wheelY + 19, width: 20, height: 20, stroke: "#ffb200", fill: "rgba(255,178,0,0.35)", strokeWidth: 2 },
    { tool: "ellipse", label: "Right hub", x: rightWheelX + 19, y: wheelY + 19, width: 20, height: 20, stroke: "#ffb200", fill: "rgba(255,178,0,0.35)", strokeWidth: 2 },
  ];
}

function buildBuildingAssistActions(document: EditorCanvasDocument): EditorAssistAction[] {
  const centerX = document.width * 0.5;
  const centerY = document.height * 0.3;
  const width = 210;
  const height = 270;
  const x = centerX - width / 2;
  const y = centerY;
  return [
    { tool: "rect", label: "Building facade", x, y, width, height, stroke: "#4d8cff", fill: "rgba(137,180,255,0.24)", strokeWidth: 5 },
    { tool: "brush", label: "Roof line", points: [x - 12, y, centerX, y - 34, x + width + 12, y], stroke: "#ffb200", strokeWidth: 6 },
    { tool: "brush", label: "Building side", points: [x + width, y, x + width + 26, y + 24, x + width + 26, y + height + 12, x + width, y + height], stroke: "#2ca24f", strokeWidth: 5 },
    { tool: "rect", label: "Door", x: centerX - 25, y: y + 181, width: 50, height: 89, stroke: "#2ca24f", fill: "rgba(44,162,79,0.14)", strokeWidth: 3 },
    { tool: "rect", label: "Window 1", x: x + 34, y: y + 51, width: 38, height: 35, stroke: "#ffb200", fill: "rgba(255,178,0,0.18)", strokeWidth: 3 },
    { tool: "rect", label: "Window 2", x: x + 134, y: y + 51, width: 38, height: 35, stroke: "#ffb200", fill: "rgba(255,178,0,0.18)", strokeWidth: 3 },
    { tool: "rect", label: "Window 3", x: x + 34, y: y + 116, width: 38, height: 35, stroke: "#ffb200", fill: "rgba(255,178,0,0.18)", strokeWidth: 3 },
    { tool: "rect", label: "Window 4", x: x + 134, y: y + 116, width: 38, height: 35, stroke: "#ffb200", fill: "rgba(255,178,0,0.18)", strokeWidth: 3 },
    { tool: "brush", label: "Ground line", points: [x - 36, y + height + 14, centerX, y + height + 20, x + width + 46, y + height + 14], stroke: "#2ca24f", strokeWidth: 4 },
  ];
}

function buildBarnAssistActions(document: EditorCanvasDocument): EditorAssistAction[] {
  const centerX = document.width * 0.5;
  const centerY = document.height * 0.4;
  const width = 260;
  const height = 168;
  const x = centerX - width / 2;
  const y = centerY;
  const doorWidth = width * 0.27;
  const doorHeight = height * 0.62;
  const doorX = centerX - doorWidth / 2;
  const doorY = y + height - doorHeight;
  return [
    { tool: "rect", label: "Barn facade", x, y, width, height, stroke: "#b63c3c", fill: "rgba(205,66,66,0.22)", strokeWidth: 5 },
    { tool: "brush", label: "Gable roof", points: [x - 16, y + 4, centerX, y - 116, x + width + 16, y + 4], stroke: "#7a2c2c", strokeWidth: 7 },
    { tool: "brush", label: "Roof edge", points: [x - 20, y + 4, x + width + 20, y + 4], stroke: "#7a2c2c", strokeWidth: 5 },
    { tool: "rect", label: "Barn doors", x: doorX, y: doorY, width: doorWidth, height: doorHeight, stroke: "#6d3f2b", fill: "rgba(115,73,49,0.18)", strokeWidth: 4 },
    { tool: "brush", label: "Door split", points: [centerX, doorY, centerX, y + height], stroke: "#6d3f2b", strokeWidth: 4 },
    { tool: "brush", label: "Door brace left", points: [doorX + doorWidth * 0.1, doorY + doorHeight * 0.84, doorX + doorWidth * 0.46, doorY + doorHeight * 0.18], stroke: "#f4d29d", strokeWidth: 4 },
    { tool: "brush", label: "Door brace right", points: [doorX + doorWidth * 0.9, doorY + doorHeight * 0.84, doorX + doorWidth * 0.54, doorY + doorHeight * 0.18], stroke: "#f4d29d", strokeWidth: 4 },
    { tool: "rect", label: "Hay loft", x: centerX - width * 0.09, y: y + height * 0.12, width: width * 0.18, height: height * 0.2, stroke: "#f4d29d", fill: "rgba(244,210,157,0.2)", strokeWidth: 3 },
    { tool: "brush", label: "Siding", points: [x + 12, y + height * 0.24, doorX - 8, y + height * 0.24, doorX + doorWidth + 8, y + height * 0.24, x + width - 12, y + height * 0.24, x + 12, y + height * 0.48, doorX - 8, y + height * 0.48, doorX + doorWidth + 8, y + height * 0.48, x + width - 12, y + height * 0.48, x + 12, y + height * 0.72, doorX - 8, y + height * 0.72, doorX + doorWidth + 8, y + height * 0.72, x + width - 12, y + height * 0.72], stroke: "#d86a5b", strokeWidth: 3 },
    { tool: "brush", label: "Ground", points: [x - 42, y + height + 14, centerX, y + height + 22, x + width + 44, y + height + 14], stroke: "#5f7a3c", strokeWidth: 5 },
  ];
}

function buildMotorcycleAssistActions(document: EditorCanvasDocument): EditorAssistAction[] {
  const centerX = document.width * 0.5;
  const centerY = document.height * 0.45;
  const wheel = 62;
  const leftWheelX = centerX - 122;
  const rightWheelX = centerX + 60;
  const wheelY = centerY + 60;
  return [
    { tool: "ellipse", label: "Rear wheel", x: leftWheelX, y: wheelY, width: wheel, height: wheel, stroke: "#3d4655", fill: "rgba(61,70,85,0.2)", strokeWidth: 6 },
    { tool: "ellipse", label: "Front wheel", x: rightWheelX, y: wheelY, width: wheel, height: wheel, stroke: "#3d4655", fill: "rgba(61,70,85,0.2)", strokeWidth: 6 },
    { tool: "brush", label: "Frame", points: [leftWheelX + 31, wheelY + 31, centerX - 22, centerY + 32, centerX + 38, centerY + 70, rightWheelX + 31, wheelY + 31], stroke: "#e84a5f", strokeWidth: 7 },
    { tool: "brush", label: "Fuel tank", points: [centerX - 26, centerY + 34, centerX - 2, centerY - 10, centerX + 58, centerY + 8, centerX + 38, centerY + 70], stroke: "#e84a5f", strokeWidth: 6 },
    { tool: "brush", label: "Seat", points: [centerX - 74, centerY + 8, centerX - 12, centerY + 2, centerX + 4, centerY + 20, centerX - 58, centerY + 28], stroke: "#ffb200", strokeWidth: 6 },
    { tool: "brush", label: "Fork and handlebar", points: [rightWheelX + 31, wheelY + 31, centerX + 82, centerY + 10, centerX + 106, centerY - 34, centerX + 72, centerY - 38], stroke: "#2ca24f", strokeWidth: 5 },
    { tool: "brush", label: "Exhaust", points: [centerX - 52, centerY + 48, centerX - 92, centerY + 76, leftWheelX + 19, wheelY + 42], stroke: "#ffb200", strokeWidth: 5 },
    { tool: "ellipse", label: "Headlight", x: centerX + 90, y: centerY - 44, width: 22, height: 22, stroke: "#ffb200", fill: "rgba(255,178,0,0.45)", strokeWidth: 3 },
  ];
}

function buildGenericDoodleAssistPlan(prompt: string, document: EditorCanvasDocument): EditorAssistPlan {
  const subject = extractFallbackText(prompt);
  const seed = hashFallbackText(prompt);
  const centerX = document.width * 0.5;
  const centerY = document.height * 0.5;
  const size = Math.min(document.width, document.height) * 0.2;
  const stroke = ["#ff5fb2", "#4d8cff", "#2ca24f", "#e84a5f"][seed % 4];
  const accent = ["#ffb200", "#ff8a5b", "#5abf9a", "#8e6cff"][Math.floor(seed / 7) % 4];
  return {
    mode: "canvas",
    assistantMessage: `Doodling ${subject} with easel tools.`,
    actions: [
      { tool: "ellipse", label: "Doodle form", x: centerX - size * 0.56, y: centerY - size * 0.5, width: size * 1.12, height: size, stroke, fill: "rgba(255,95,178,0.16)", strokeWidth: 5 },
      { tool: "brush", label: "Doodle contour", points: [centerX - size * 0.5, centerY + size * 0.12, centerX - size * 0.24, centerY - size * 0.54, centerX + size * 0.28, centerY - size * 0.44, centerX + size * 0.52, centerY + size * 0.1, centerX + size * 0.1, centerY + size * 0.48, centerX - size * 0.5, centerY + size * 0.12], stroke, strokeWidth: 6 },
      { tool: "brush", label: "Doodle structure", points: [centerX - size * 0.3, centerY + size * 0.04, centerX, centerY - size * 0.22, centerX + size * 0.3, centerY + size * 0.04, centerX + size * 0.06, centerY + size * 0.24], stroke: accent, strokeWidth: 5 },
      { tool: "brush", label: "Doodle detail", points: [centerX - size * 0.28, centerY + size * 0.3, centerX - size * 0.06, centerY + size * 0.1, centerX + size * 0.18, centerY + size * 0.28, centerX + size * 0.32, centerY + size * 0.12], stroke, strokeWidth: 4 },
      { tool: "brush", label: "Doodle ground", points: [centerX - size * 0.58, centerY + size * 0.56, centerX - size * 0.2, centerY + size * 0.6, centerX + size * 0.2, centerY + size * 0.56, centerX + size * 0.6, centerY + size * 0.6], stroke: accent, strokeWidth: 4 },
      { tool: "ellipse", label: "Doodle accent", x: centerX - size * 0.12, y: centerY + size * 0.1, width: size * 0.24, height: size * 0.18, stroke: accent, fill: "rgba(255,178,0,0.32)", strokeWidth: 3 },
    ],
  };
}

function hashFallbackText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function extractFallbackText(prompt: string) {
  const quoted = prompt.match(/["“]([^"”]{1,80})["”]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  const cleaned = prompt.replace(/^(draw|make|create|generate|sketch|paint|add|show)\s+/i, "").replace(/^(a|an|the)\s+/i, "").trim();
  const normalized = cleaned || prompt.trim() || "Canvas note";
  const shortened = normalized.length > 48 ? `${normalized.slice(0, 45).trim()}...` : normalized;
  return shortened.charAt(0).toUpperCase() + shortened.slice(1);
}

function extractExplanationFallbackTopic(prompt: string) {
  const cleaned = prompt.trim();
  const direct = cleaned.match(/^(?:explain|describe|summarize|teach me|tell me about|what is|how does|how do|why does|why do)\s+(.+)$/i);
  if (direct?.[1]) {
    return direct[1].replace(/[?.!]+$/g, "").trim();
  }
  return null;
}

function isExplanationFallbackPrompt(prompt: string) {
  return /^(?:explain|describe|summarize|teach me|tell me about|what is|how does|how do|why does|why do)\b/i.test(prompt.trim());
}

function isMathFallbackPrompt(prompt: string) {
  return /(?:\d\s*[a-z]?\s*[+\-*/^=]|\b(?:solve|equation|derivative|differentiate|integral|integrate|limit|calculus|elasticity|marginal|supply|demand|revenue|cost|profit|interest|percentage)\b)/i.test(prompt);
}

function toDisplayFallbackTopic(topic: string) {
  const cleaned = topic.trim();
  if (!cleaned) return "This topic";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function resolveFallbackPlacement(document: EditorCanvasDocument, prompt: string, width: number, height: number) {
  const padding = 28;
  const maxX = Math.max(padding, document.width - width - padding);
  const maxY = Math.max(padding, document.height - height - padding);
  const lower = prompt.toLowerCase();
  const left = /\b(?:top|upper|bottom|lower)?\s*(?:left|left-hand)\b/.test(lower);
  const right = /\b(?:top|upper|bottom|lower)?\s*(?:right|right-hand)\b/.test(lower);
  const top = /\b(?:top|upper)\b/.test(lower);
  const bottom = /\b(?:bottom|lower)\b/.test(lower);
  const center = /\b(?:center|centre|middle)\b/.test(lower);
  const requested = {
    x: left ? padding : right ? maxX : center ? (document.width - width) / 2 : null,
    y: top ? padding : bottom ? maxY : center ? (document.height - height) / 2 : null,
  };
  return resolveLocalUnoccupiedPlacement(document, width, height, requested.x, requested.y);
}

function placeLocalFallbackPlan(plan: EditorAssistPlan, prompt: string, document: EditorCanvasDocument): EditorAssistPlan {
  const bounds = getAssistActionBounds(plan.actions);
  if (!bounds) return plan;
  const placement = resolveFallbackPlacement(document, prompt, bounds.width, bounds.height);
  const dx = placement.x - bounds.x;
  const dy = placement.y - bounds.y;
  return {
    ...plan,
    actions: plan.actions.map((action) => ({
      ...action,
      x: typeof action.x === "number" ? action.x + dx : action.x,
      y: typeof action.y === "number" ? action.y + dy : action.y,
      points: Array.isArray(action.points)
        ? action.points.map((point, index) => point + (index % 2 === 0 ? dx : dy))
        : action.points,
    })),
  };
}

function resolveLocalUnoccupiedPlacement(document: EditorCanvasDocument, width: number, height: number, requestedX: number | null, requestedY: number | null) {
  const padding = 28;
  const maxX = Math.max(padding, document.width - width - padding);
  const maxY = Math.max(padding, document.height - height - padding);
  const positions: Array<{ x: number; y: number }> = requestedX !== null || requestedY !== null
    ? [{ x: requestedX ?? (document.width - width) / 2, y: requestedY ?? (document.height - height) / 2 }]
    : [];
  const steps = 4;
  for (let row = 0; row <= steps; row += 1) {
    for (let column = 0; column <= steps; column += 1) {
      positions.push({ x: padding + (maxX - padding) * column / steps, y: padding + (maxY - padding) * row / steps });
    }
  }
  const candidates = positions.map((position) => ({
    x: Math.round(Math.max(padding, Math.min(maxX, position.x))),
    y: Math.round(Math.max(padding, Math.min(maxY, position.y))),
  }));
  const occupied = document.layers.map(({ x, y, width, height }) => ({ x, y, width, height }));
  const openCandidate = candidates.find((candidate) => !occupied.some((bounds) => assistBoundsIntersect({ ...candidate, width, height }, bounds)));
  if (openCandidate) return openCandidate;
  return candidates.reduce((best, candidate) => (
    localOverlapArea({ ...candidate, width, height }, occupied) < localOverlapArea({ ...best, width, height }, occupied)
      ? candidate
      : best
  ));
}

function getAssistActionBounds(actions: EditorAssistAction[]) {
  const points: Array<{ x: number; y: number }> = [];
  for (const action of actions) {
    if (typeof action.x === "number" && typeof action.y === "number") {
      points.push({ x: action.x, y: action.y }, { x: action.x + (action.width || 0), y: action.y + (action.height || 0) });
    }
    if (Array.isArray(action.points)) {
      for (let index = 0; index < action.points.length - 1; index += 2) {
        points.push({ x: action.points[index], y: action.points[index + 1] });
      }
    }
  }
  if (!points.length) return null;
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const x = Math.min(...xValues);
  const y = Math.min(...yValues);
  return { x, y, width: Math.max(1, Math.max(...xValues) - x), height: Math.max(1, Math.max(...yValues) - y) };
}

function assistBoundsIntersect(first: { x: number; y: number; width: number; height: number }, second: { x: number; y: number; width: number; height: number }) {
  return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function localOverlapArea(candidate: { x: number; y: number; width: number; height: number }, occupied: Array<{ x: number; y: number; width: number; height: number }>) {
  return occupied.reduce((area, bounds) => {
    const width = Math.max(0, Math.min(candidate.x + candidate.width, bounds.x + bounds.width) - Math.max(candidate.x, bounds.x));
    const height = Math.max(0, Math.min(candidate.y + candidate.height, bounds.y + bounds.height) - Math.max(candidate.y, bounds.y));
    return area + width * height;
  }, 0);
}

function buildDeterministicExplanationSections(topic: string) {
  if (/photosynthesis/i.test(topic)) {
    return {
      summary: "Photosynthesis is how plants use sunlight to make sugar for energy and growth.",
      keyPoints: [
        "Plants absorb water through their roots and carbon dioxide from the air.",
        "Light energy drives a reaction in the leaves that turns those inputs into sugar.",
        "Oxygen is released as a byproduct, which helps support life on Earth.",
      ],
    };
  }

  if (/thermodynamics|laws? of thermodynamics|heat and energy/i.test(topic)) {
    return {
      summary: "Thermodynamics explains how energy moves and changes form, especially through heat and work.",
      keyPoints: [
        "The first law says energy is conserved: it can transfer or transform, but it is not created or destroyed.",
        "Heat naturally flows from warmer objects to cooler ones until their temperatures become more even.",
        "The second law introduces entropy: energy spreads out, so no engine can turn all heat into useful work.",
      ],
    };
  }

  const subject = toDisplayFallbackTopic(topic);
  return {
    summary: `${subject} is easiest to understand by focusing on what it is, how it works, and why it matters.`,
    keyPoints: [
      "Start with the core definition so the main idea is clear.",
      "Break the process or structure into simple parts or steps.",
      "End with the outcome, use, or reason the topic is important.",
    ],
  };
}

function wrapFallbackText(value: string, maxLineLength: number) {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.slice(0, 7);
}

function getAssistTargetBounds(document: EditorCanvasDocument, selectedLayer: EditorAssistSelectedLayer | null) {
  if (!selectedLayer) {
    const width = Math.min(360, document.width * 0.5);
    const height = Math.min(220, document.height * 0.3);
    return {
      x: document.width / 2 - width / 2,
      y: document.height / 2 - height / 2,
      width,
      height,
    };
  }
  const pad = 18;
  return {
    x: Math.max(0, selectedLayer.x - pad),
    y: Math.max(0, selectedLayer.y - pad),
    width: Math.min(document.width, selectedLayer.width + pad * 2),
    height: Math.min(document.height, selectedLayer.height + pad * 2),
  };
}

function buildArrowAssistPoints(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const headLength = Math.max(18, Math.min(36, Math.hypot(dx, dy) * 0.18));
  const leftX = x2 - headLength * Math.cos(angle - Math.PI / 6);
  const leftY = y2 - headLength * Math.sin(angle - Math.PI / 6);
  const rightX = x2 - headLength * Math.cos(angle + Math.PI / 6);
  const rightY = y2 - headLength * Math.sin(angle + Math.PI / 6);
  return [x1, y1, x2, y2, leftX, leftY, x2, y2, rightX, rightY];
}
