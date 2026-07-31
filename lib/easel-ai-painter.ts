import type { EditorAssistAction, EditorPaintDetailLevel, EditorPaintPass } from "@/types/easy-easel";

type ReferencePaintingInput = {
  imageUrl: string;
  canvas: { width: number; height: number };
  detailLevel: EditorPaintDetailLevel;
};

type Pixel = { red: number; green: number; blue: number; alpha: number };

export async function buildReferencePaintingPlan(input: ReferencePaintingInput): Promise<EditorAssistAction[]> {
  const image = await loadImage(input.imageUrl);
  const bounds = fitReference(image.naturalWidth, image.naturalHeight, input.canvas.width, input.canvas.height);
  const sampling = getSampling(input.detailLevel, bounds.width, bounds.height);
  const source = document.createElement("canvas");
  source.width = sampling.columns;
  source.height = sampling.rows;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The reference could not be prepared for painting.");
  context.drawImage(image, 0, 0, source.width, source.height);
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  const actions: EditorAssistAction[] = [];

  appendPass(actions, "background", pixels, sampling, bounds, 3, 0.88, 1.45, (pixel, x, y) => isBackgroundPixel(pixel, sample(pixels, sampling.columns, sampling.rows, x, y)));
  appendPass(actions, "major-forms", pixels, sampling, bounds, 2, 0.76, 1.05, (pixel, x, y) => !isBackgroundPixel(pixel, sample(pixels, sampling.columns, sampling.rows, x, y)) && !isEdge(pixels, sampling.columns, sampling.rows, x, y));
  appendPass(actions, "shading", pixels, sampling, bounds, 1, 0.34, 0.74, (_pixel, x, y) => isShadow(pixels, sampling.columns, sampling.rows, x, y));
  appendPass(actions, "facial-features", pixels, sampling, bounds, 1, 0.82, 0.42, (_pixel, x, y) => isFocalDetail(pixels, sampling.columns, sampling.rows, x, y));
  appendPass(actions, "final-detail", pixels, sampling, bounds, 1, 0.64, 0.3, (_pixel, x, y) => isEdge(pixels, sampling.columns, sampling.rows, x, y));

  return actions;
}

function appendPass(
  actions: EditorAssistAction[],
  pass: EditorPaintPass,
  pixels: Uint8ClampedArray,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number },
  stride: number,
  opacity: number,
  widthMultiplier: number,
  include: (pixel: Pixel, x: number, y: number) => boolean
) {
  for (let y = 0; y < sampling.rows; y += stride) {
    let x = 0;
    while (x < sampling.columns) {
      const pixel = getPixel(pixels, sampling.columns, x, y);
      if (!include(pixel, x, y) || pixel.alpha < 32) {
        x += stride;
        continue;
      }

      let end = Math.min(sampling.columns - 1, x + stride - 1);
      while (end + stride < sampling.columns) {
        const next = getPixel(pixels, sampling.columns, end + stride, y);
        if (!include(next, end + stride, y) || colorDistance(pixel, next) > 24) break;
        end += stride;
      }

      const startX = bounds.x + (x + 0.1) * sampling.cellWidth;
      const endX = bounds.x + (end + 0.9) * sampling.cellWidth;
      const centerY = bounds.y + (y + 0.5) * sampling.cellHeight;
      actions.push({
        tool: "brush",
        pass,
        label: `${passLabel(pass)} ${y + 1}`,
        points: [startX, centerY, (startX + endX) / 2, centerY + sampling.cellHeight * 0.04, endX, centerY],
        stroke: toColor(pixel),
        strokeWidth: Math.max(1, Math.min(sampling.cellHeight, sampling.cellWidth) * widthMultiplier),
        opacity,
      });
      x = end + stride;
    }
  }
}

function getSampling(detailLevel: EditorPaintDetailLevel, width: number, height: number) {
  const cellSize = detailLevel === "study" ? 24 : detailLevel === "refined" ? 14 : 8;
  return {
    columns: Math.max(1, Math.ceil(width / cellSize)),
    rows: Math.max(1, Math.ceil(height / cellSize)),
    cellWidth: cellSize,
    cellHeight: cellSize,
  };
}

function fitReference(sourceWidth: number, sourceHeight: number, canvasWidth: number, canvasHeight: number) {
  const scale = Math.min((canvasWidth * 0.82) / sourceWidth, (canvasHeight * 0.78) / sourceHeight);
  const width = Math.max(1, sourceWidth * scale);
  const height = Math.max(1, sourceHeight * scale);
  return { x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2, width, height };
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The reference image could not be read. Use an uploaded or library image with browser access."));
    image.src = source;
  });
}

function getPixel(data: Uint8ClampedArray, columns: number, x: number, y: number): Pixel {
  const index = (y * columns + x) * 4;
  return { red: data[index], green: data[index + 1], blue: data[index + 2], alpha: data[index + 3] };
}

function sample(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number) {
  return getPixel(data, columns, Math.max(0, Math.min(columns - 1, x)), Math.max(0, Math.min(rows - 1, y)));
}

function colorDistance(first: Pixel, second: Pixel) {
  return Math.abs(first.red - second.red) + Math.abs(first.green - second.green) + Math.abs(first.blue - second.blue);
}

function brightness(pixel: Pixel) {
  return pixel.red * 0.2126 + pixel.green * 0.7152 + pixel.blue * 0.0722;
}

function isBackgroundPixel(pixel: Pixel, nearby: Pixel) {
  return brightness(pixel) > 205 || colorDistance(pixel, nearby) < 16;
}

function isShadow(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number) {
  const pixel = sample(data, columns, rows, x, y);
  return brightness(pixel) < 105 && !isEdge(data, columns, rows, x, y);
}

function isFocalDetail(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number) {
  const centralFaceRegion = x > columns * 0.22 && x < columns * 0.78 && y > rows * 0.14 && y < rows * 0.58;
  return centralFaceRegion && brightness(sample(data, columns, rows, x, y)) < 125 && isEdge(data, columns, rows, x, y);
}

function isEdge(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number) {
  const pixel = sample(data, columns, rows, x, y);
  return colorDistance(pixel, sample(data, columns, rows, x + 1, y)) > 70 || colorDistance(pixel, sample(data, columns, rows, x, y + 1)) > 70;
}

function toColor(pixel: Pixel) {
  return `rgb(${pixel.red}, ${pixel.green}, ${pixel.blue})`;
}

function passLabel(pass: EditorPaintPass) {
  return pass.replace(/-/g, " ");
}