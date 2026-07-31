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

  appendPass(actions, "background", pixels, sampling, bounds, 3, 0.58, 1.85, 130, (pixel) => isBackgroundPixel(pixel, backgroundColors));
  appendPass(actions, "major-forms", pixels, sampling, bounds, 2, 0.66, 1.4, 220, (pixel) => !isBackgroundPixel(pixel, backgroundColors));
  appendPass(actions, "shading", pixels, sampling, bounds, 3, 0.4, 0.78, 100, (_pixel, x, y) => isShadow(pixels, sampling.columns, sampling.rows, x, y));
  appendFaceFeaturePass(actions, pixels, sampling, bounds);
  appendPass(actions, "final-detail", pixels, sampling, bounds, 3, 0.8, 0.42, 180, (_pixel, x, y) => isRefinementCandidate(pixels, sampling.columns, sampling.rows, x, y));

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
  maxStrokes: number,
  include: (pixel: Pixel, x: number, y: number) => boolean
) {
  const candidates: Array<{ action: EditorAssistAction; priority: number }> = [];
  for (let y = 0; y < sampling.rows; y += stride) {
    const rowOffset = (Math.floor(y / stride) % 2) * Math.max(1, Math.floor(stride / 2));
    for (let x = rowOffset; x < sampling.columns; x += stride) {
      const pixel = averagePixel(pixels, sampling.columns, sampling.rows, x, y);
      if (!include(pixel, x, y) || pixel.alpha < 32) {
        continue;
      }

          const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
      const color = toColor(quantizePixel(pixel, unit <= 12 ? 16 : 24));
      const direction = strokeDirection(pixels, sampling.columns, sampling.rows, x, y, pass);
          const contrast = localContrast(pixels, sampling.columns, sampling.rows, x, y);
          const brushScale = adaptiveBrushScale(pass, contrast);
          const length = unit * brushScale * (pass === "background" ? 3.2 : pass === "major-forms" ? 2.55 : pass === "final-detail" || pass === "facial-features" ? 1.15 : 1.7);
          const jitter = strokeJitter(x, y, pass, unit * 1.25);
          const centerX = bounds.x + (x + 0.5) * sampling.cellWidth + jitter.x;
          const centerY = bounds.y + (y + 0.5) * sampling.cellHeight + jitter.y;
      const offsetX = Math.cos(direction) * length * 0.5;
      const offsetY = Math.sin(direction) * length * 0.5;
      const curveX = Math.cos(direction + Math.PI / 2) * length * 0.08;
      const curveY = Math.sin(direction + Math.PI / 2) * length * 0.08;
      candidates.push({
        priority: pass === "background" ? 255 - contrast : refinementError(pixels, sampling.columns, sampling.rows, x, y),
        action: {
        tool: "brush",
        pass,
        label: passLabel(pass),
        points: [centerX - offsetX, centerY - offsetY, centerX + curveX, centerY + curveY, centerX + offsetX, centerY + offsetY],
        stroke: color,
        strokeWidth: Math.max(1, unit * widthMultiplier * brushScale),
        opacity,
        },
      });
    }
  }
  candidates.sort((first, second) => second.priority - first.priority);
  actions.push(...candidates.slice(0, maxStrokes).map((candidate) => candidate.action));
}

function getSampling(detailLevel: EditorPaintDetailLevel, width: number, height: number) {
  const cellSize = detailLevel === "study" ? 28 : detailLevel === "refined" ? 9.25 : 8;
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
  return `rgb(${pixel.red}, ${pixel.green}, ${pixel.blue})`;
}

function detailBlur(detailLevel: EditorPaintDetailLevel) {
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

function passLabel(pass: EditorPaintPass) {
  return pass.replace(/-/g, " ");
}

function strokeDirection(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number, pass: EditorPaintPass) {
  const left = brightness(sample(data, columns, rows, x - 1, y));
  const right = brightness(sample(data, columns, rows, x + 1, y));
  const top = brightness(sample(data, columns, rows, x, y - 1));
  const bottom = brightness(sample(data, columns, rows, x, y + 1));
  const contourDirection = Math.atan2(bottom - top, right - left) + Math.PI / 2;
  if (pass !== "background" && pass !== "major-forms") return contourDirection;

  const variation = (((x * 17 + y * 31) % 13) - 6) * 0.07;
  return contourDirection + variation;
}

function quantizePixel(pixel: Pixel, step: number): Pixel {
  const quantize = (value: number) => Math.min(255, Math.round(value / step) * step);
  return { red: quantize(pixel.red), green: quantize(pixel.green), blue: quantize(pixel.blue), alpha: pixel.alpha };
}

function appendFaceFeaturePass(
  actions: EditorAssistAction[],
  pixels: Uint8ClampedArray,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number }
) {
  const face = {
    left: Math.floor(sampling.columns * 0.25),
    right: Math.ceil(sampling.columns * 0.62),
    top: Math.floor(sampling.rows * 0.16),
    bottom: Math.ceil(sampling.rows * 0.63),
  };
  const candidates: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  for (let y = face.top; y < face.bottom; y += 1) {
    for (let x = face.left; x < face.right; x += 1) {
      const pixel = averagePixel(pixels, sampling.columns, sampling.rows, x, y);
      const score = localContrast(pixels, sampling.columns, sampling.rows, x, y);
      if (brightness(pixel) < 150 && score > 80) candidates.push({ x, y, score, pixel });
    }
  }

  candidates.sort((first, second) => second.score - first.score);
  const selected: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  for (const candidate of candidates) {
    if (selected.some((feature) => Math.abs(feature.x - candidate.x) < 2 && Math.abs(feature.y - candidate.y) < 2)) continue;
    selected.push(candidate);
    if (selected.length === 70) break;
  }

  for (const feature of selected) {
    const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
    const direction = strokeDirection(pixels, sampling.columns, sampling.rows, feature.x, feature.y, "facial-features");
    const centerX = bounds.x + (feature.x + 0.5) * sampling.cellWidth;
    const centerY = bounds.y + (feature.y + 0.5) * sampling.cellHeight;
    const length = unit * 1.2;
    const offsetX = Math.cos(direction) * length * 0.5;
    const offsetY = Math.sin(direction) * length * 0.5;
    actions.push({
      tool: "brush",
      pass: "facial-features",
      label: `Facial feature ${actions.length + 1}`,
      points: [centerX - offsetX, centerY - offsetY, centerX, centerY, centerX + offsetX, centerY + offsetY],
      stroke: toColor(quantizePixel(feature.pixel, 16)),
      strokeWidth: Math.max(1.5, unit * 0.42),
      opacity: 0.94,
    });
  }

  appendPortraitLandmark(actions, pixels, sampling, bounds, face, "left eye", 0.2, 0.12, 0.42);
  appendPortraitLandmark(actions, pixels, sampling, bounds, face, "right eye", 0.2, 0.58, 0.88);
  appendPortraitLandmark(actions, pixels, sampling, bounds, face, "mouth", 0.64, 0.5, 0.7);
}

function appendPortraitLandmark(
  actions: EditorAssistAction[],
  pixels: Uint8ClampedArray,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number },
  face: { left: number; right: number; top: number; bottom: number },
  label: string,
  verticalPosition: number,
  horizontalStart: number,
  horizontalEnd: number
) {
  const targetY = Math.round(face.top + (face.bottom - face.top) * verticalPosition);
  const left = Math.round(face.left + (face.right - face.left) * horizontalStart);
  const right = Math.round(face.left + (face.right - face.left) * horizontalEnd);
  let best = { x: left, y: targetY, score: -1, pixel: sample(pixels, sampling.columns, sampling.rows, left, targetY) };
  for (let y = Math.max(face.top, targetY - 2); y <= Math.min(face.bottom, targetY + 2); y += 1) {
    for (let x = left; x <= right; x += 1) {
      const pixel = averagePixel(pixels, sampling.columns, sampling.rows, x, y);
      const score = localContrast(pixels, sampling.columns, sampling.rows, x, y) + (255 - brightness(pixel));
      if (score > best.score) best = { x, y, score, pixel };
    }
  }
  const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
  const centerX = bounds.x + (best.x + 0.5) * sampling.cellWidth;
  const centerY = bounds.y + (best.y + 0.5) * sampling.cellHeight;
  const length = label === "mouth" ? unit * 2.1 : unit * 1.35;
  actions.push({
    tool: "brush",
    pass: "facial-features",
    label: label === "mouth" ? "Mouth detail" : `${label.replace(/\b\w/g, (character) => character.toUpperCase())} detail`,
    points: [centerX - length / 2, centerY, centerX, centerY + unit * 0.08, centerX + length / 2, centerY],
    stroke: toColor(darkenPixel(best.pixel, 0.52)),
    strokeWidth: Math.max(1.5, unit * 0.48),
    opacity: 0.96,
  });
}

function localContrast(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number) {
  const pixel = sample(data, columns, rows, x, y);
  return Math.max(
    colorDistance(pixel, sample(data, columns, rows, x - 1, y)),
    colorDistance(pixel, sample(data, columns, rows, x + 1, y)),
    colorDistance(pixel, sample(data, columns, rows, x, y - 1)),
    colorDistance(pixel, sample(data, columns, rows, x, y + 1))
  );
}

function refinementError(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number) {
  const pixel = sample(data, columns, rows, x, y);
  const broadTone = averageWindow(data, columns, rows, x, y, 4);
  return colorDistance(pixel, broadTone) + localContrast(data, columns, rows, x, y) * 0.6;
}

function averageWindow(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number, radius: number): Pixel {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;
  for (let yOffset = -radius; yOffset <= radius; yOffset += 1) {
    for (let xOffset = -radius; xOffset <= radius; xOffset += 1) {
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

function darkenPixel(pixel: Pixel, factor: number): Pixel {
  return { red: Math.round(pixel.red * factor), green: Math.round(pixel.green * factor), blue: Math.round(pixel.blue * factor), alpha: pixel.alpha };
}

function isRefinementCandidate(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number) {
  const contrast = localContrast(data, columns, rows, x, y);
  return contrast > 76 || (contrast > 54 && isEdge(data, columns, rows, x, y));
}

function adaptiveBrushScale(pass: EditorPaintPass, contrast: number) {
  if (pass === "background") return contrast < 28 ? 1.45 : 1.15;
  if (pass === "major-forms") return contrast > 100 ? 0.72 : contrast > 64 ? 0.9 : 1.2;
  if (pass === "shading") return contrast > 76 ? 0.82 : 1.08;
  return contrast > 100 ? 0.72 : 0.9;
}