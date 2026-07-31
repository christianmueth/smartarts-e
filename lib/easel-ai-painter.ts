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
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.filter = detailBlur(input.detailLevel);
  context.drawImage(image, 0, 0, source.width, source.height);
    context.filter = "none";
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  const backgroundColors = getBackgroundColors(pixels, sampling.columns, sampling.rows);
  const actions: EditorAssistAction[] = [];

    appendPass(actions, "background", pixels, sampling, bounds, 3, 0.38, 2.5, (pixel) => isBackgroundPixel(pixel, backgroundColors));
    appendPass(actions, "major-forms", pixels, sampling, bounds, 2, 0.52, 1.75, (pixel, x, y) => !isBackgroundPixel(pixel, backgroundColors) && !isEdge(pixels, sampling.columns, sampling.rows, x, y));
    appendPass(actions, "shading", pixels, sampling, bounds, 1, 0.32, 1.05, (_pixel, x, y) => isShadow(pixels, sampling.columns, sampling.rows, x, y));
    appendPass(actions, "facial-features", pixels, sampling, bounds, 1, 0.78, 0.68, (_pixel, x, y) => isFocalDetail(pixels, sampling.columns, sampling.rows, x, y));
    appendPass(actions, "final-detail", pixels, sampling, bounds, 1, 0.62, 0.48, (_pixel, x, y) => isEdge(pixels, sampling.columns, sampling.rows, x, y));

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
    for (let x = 0; x < sampling.columns; x += stride) {
      const pixel = getPixel(pixels, sampling.columns, x, y);
      if (!include(pixel, x, y) || pixel.alpha < 32) {
        continue;
      }

      const direction = strokeDirection(pixels, sampling.columns, sampling.rows, x, y, pass);
          const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
          const length = unit * (pass === "final-detail" || pass === "facial-features" ? 1.1 : 1.85);
          const jitter = strokeJitter(x, y, pass, unit);
          const centerX = bounds.x + (x + 0.5) * sampling.cellWidth + jitter.x;
          const centerY = bounds.y + (y + 0.5) * sampling.cellHeight + jitter.y;
      const offsetX = Math.cos(direction) * length * 0.5;
      const offsetY = Math.sin(direction) * length * 0.5;
      const curveX = Math.cos(direction + Math.PI / 2) * length * 0.12;
      const curveY = Math.sin(direction + Math.PI / 2) * length * 0.12;
      actions.push({
        tool: "brush",
        pass,
        label: `${passLabel(pass)} stroke ${actions.length + 1}`,
        points: [centerX - offsetX, centerY - offsetY, centerX + curveX, centerY + curveY, centerX + offsetX, centerY + offsetY],
        stroke: toColor(pixel),
        strokeWidth: Math.max(1, Math.min(sampling.cellHeight, sampling.cellWidth) * widthMultiplier),
        opacity,
      });
    }
  }
}

function getSampling(detailLevel: EditorPaintDetailLevel, width: number, height: number) {
  const cellSize = detailLevel === "study" ? 28 : detailLevel === "refined" ? 18 : 11;
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
function isBackgroundPixel(pixel: Pixel, backgroundColors: Pixel[]) {
  return backgroundColors.some((background) => colorDistance(pixel, background) < 58);
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
    return detailLevel === "study" ? "blur(1.8px)" : detailLevel === "refined" ? "blur(1.1px)" : "blur(0.6px)";
  }

  function getBackgroundColors(data: Uint8ClampedArray, columns: number, rows: number) {
    return [
      averagePixel(data, columns, rows, 0, 0),
      averagePixel(data, columns, rows, columns - 1, 0),
      averagePixel(data, columns, rows, 0, rows - 1),
      averagePixel(data, columns, rows, columns - 1, rows - 1),
    ];
  }

  function averagePixel(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number): Pixel {
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    let count = 0;
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        const pixel = sample(data, columns, rows, x + xOffset, y + yOffset);
        red += pixel.red;
        green += pixel.green;
        blue += pixel.blue;
        alpha += pixel.alpha;
        count += 1;
      }
    }
    return { red: Math.round(red / count), green: Math.round(green / count), blue: Math.round(blue / count), alpha: Math.round(alpha / count) };
  }

  function strokeJitter(x: number, y: number, pass: EditorPaintPass, unit: number) {
    const seed = x * 73856093 ^ y * 19349663 ^ pass.length * 83492791;
    const horizontal = ((seed >>> 5) % 1000) / 1000 - 0.5;
    const vertical = ((seed >>> 15) % 1000) / 1000 - 0.5;
    return { x: horizontal * unit * 0.44, y: vertical * unit * 0.44 };
  }
  return `rgb(${pixel.red}, ${pixel.green}, ${pixel.blue})`;
}

function passLabel(pass: EditorPaintPass) {
  return pass.replace(/-/g, " ");
}

function strokeDirection(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number, pass: EditorPaintPass) {
  if (pass === "background" || pass === "major-forms") {
    const variation = ((x * 17 + y * 31) % 9) - 4;
    return variation * 0.16 + (x % 3 === 0 ? 0.55 : -0.32);
  }
  const left = brightness(sample(data, columns, rows, x - 1, y));
  const right = brightness(sample(data, columns, rows, x + 1, y));
  const top = brightness(sample(data, columns, rows, x, y - 1));
  const bottom = brightness(sample(data, columns, rows, x, y + 1));
  return Math.atan2(bottom - top, right - left) + Math.PI / 2;
}