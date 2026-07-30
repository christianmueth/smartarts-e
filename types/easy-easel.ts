export type EditorAssetType = "upload" | "generated" | "edited";

export type EditorLayerKind = "image" | "text" | "rect" | "ellipse" | "line";

export type EditorBaseLayer = {
  id: string;
  kind: EditorLayerKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
};

export type EditorImageLayer = EditorBaseLayer & {
  kind: "image";
  assetId: string | null;
  src: string;
  brightness: number;
  contrast: number;
};

export type EditorTextLayer = EditorBaseLayer & {
  kind: "text";
  text: string;
  fill: string;
  fontSize: number;
  fontFamily: string;
};

export type EditorShapeLayer = EditorBaseLayer & {
  kind: "rect" | "ellipse";
  fill: string;
  stroke: string;
  strokeWidth: number;
};

export type EditorDrawLayer = EditorBaseLayer & {
  kind: "line";
  points: number[];
  stroke: string;
  strokeWidth: number;
  compositeMode: "source-over" | "destination-out";
};

export type EditorLayer = EditorImageLayer | EditorTextLayer | EditorShapeLayer | EditorDrawLayer;

export type EditorCanvasDocument = {
  width: number;
  height: number;
  backgroundColor: string;
  layers: EditorLayer[];
};

export type EditorProjectSummary = {
  id: string;
  name: string;
  previewUrl: string | null;
  updatedAt: string;
  createdAt: string;
};

export type EditorProjectDetail = EditorProjectSummary & {
  canvas: EditorCanvasDocument;
};

export type EditorAsset = {
  id: string;
  title: string;
  imageUrl: string;
  type: EditorAssetType;
  sourceAssetId: string | null;
  prompt: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
};

export type EditorCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function createEmptyEditorDocument(): EditorCanvasDocument {
  return {
    width: 1400,
    height: 900,
    backgroundColor: "#ffffff",
    layers: [],
  };
}
