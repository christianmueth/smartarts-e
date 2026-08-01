import type { EditorAssistAction, EditorPaintDetailLevel, EditorPaintPass, EditorPaintStyle } from "@/types/easy-easel";

type ReferencePaintingInput = {
  imageUrl: string;
  canvas: { width: number; height: number };
  detailLevel: EditorPaintDetailLevel;
  style: EditorPaintStyle;
};

type Pixel = { red: number; green: number; blue: number; alpha: number };

export async function buildReferencePaintingPlan(input: ReferencePaintingInput): Promise<EditorAssistAction[]> {
  const image = await loadImage(input.imageUrl);
  const bounds = fitReference(image.naturalWidth, image.naturalHeight, input.canvas.width, input.canvas.height);
  const sampling = getSampling(input.detailLevel, bounds.width, bounds.height);
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The reference could not be prepared for painting.");
  context.drawImage(image, 0, 0, source.width, source.height);
  const fullResolutionPixels = context.getImageData(0, 0, source.width, source.height).data;
  const pixels = samplePlanningPixels(fullResolutionPixels, source.width, source.height, sampling);
  const pyramid = buildReferencePyramid(fullResolutionPixels, source.width, source.height);
  const backgroundColors = getBackgroundColors(pixels, sampling.columns, sampling.rows);
  const actions: EditorAssistAction[] = [];

  appendUnderpainting(actions, pixels, sampling, bounds, input.style);
  if (isPainterlyStyle(input.style)) {
    appendPainterlyReconstruction(actions, pixels, pyramid, sampling, bounds, input.style);
  }
  appendPass(actions, "background", pixels, sampling, bounds, 4, 0.26, 0.9, input.style, (_pixel, x, y) => isEdge(pixels, sampling.columns, sampling.rows, x, y) && isBackgroundPixel(sample(pixels, sampling.columns, sampling.rows, x, y), backgroundColors));
  appendPass(actions, "major-forms", pixels, sampling, bounds, 3, 0.34, 0.74, input.style, (_pixel, x, y) => isEdge(pixels, sampling.columns, sampling.rows, x, y) && !isBackgroundPixel(sample(pixels, sampling.columns, sampling.rows, x, y), backgroundColors));
  appendPass(actions, "shading", pixels, sampling, bounds, 4, 0.32, 0.58, input.style, (_pixel, x, y) => isShadow(pixels, sampling.columns, sampling.rows, x, y));
  appendFaceFeaturePass(actions, pixels, sampling, bounds, input.style);
  appendPass(actions, "final-detail", pixels, sampling, bounds, 3, input.style === "realistic" ? 0.8 : 0.46, input.style === "realistic" ? 0.42 : 0.58, input.style, (_pixel, x, y) => isEdge(pixels, sampling.columns, sampling.rows, x, y));
  appendRefinementPass(actions, pixels, sampling, bounds, refinementLimit(input.detailLevel), input.style);
  if (isPainterlyStyle(input.style)) {
    appendGlazePass(actions, pixels, sampling, bounds, glazeLimit(input.detailLevel));
    appendEdgeSharpeningPass(actions, pixels, sampling, bounds, input.style);
    appendFeatureLockPass(actions, pixels, sampling, bounds, input.detailLevel, input.style);
    appendMicroFeaturePass(actions, pixels, sampling, bounds, input.detailLevel, input.style);
  }

  return applyPaintingStyle(actions, input.style);
}

function appendUnderpainting(
  actions: EditorAssistAction[],
  pixels: Uint8ClampedArray,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number },
  style: EditorPaintStyle
) {
  if (style === "realistic") {
    for (let y = 0; y < sampling.rows; y += 1) {
      for (let x = 0; x < sampling.columns; x += 1) {
        const pixel = averagePixel(pixels, sampling.columns, sampling.rows, x, y);
        actions.push({
          tool: "rect",
          pass: "background",
          label: `Underpainting region ${actions.length + 1}`,
          x: bounds.x + x * sampling.cellWidth,
          y: bounds.y + y * sampling.cellHeight,
          width: Math.min(bounds.width - x * sampling.cellWidth, sampling.cellWidth + 1),
          height: Math.min(bounds.height - y * sampling.cellHeight, sampling.cellHeight + 1),
          fill: toColor(quantizePixel(pixel, 16)),
          stroke: "rgba(0,0,0,0)",
          strokeWidth: 1,
          opacity: 1,
        });
      }
    }
    return;
  }

  const stride = 2;
  for (let y = 0; y < sampling.rows; y += stride) {
    const rowOffset = (Math.floor(y / stride) % 2) * stride;
    for (let x = rowOffset; x < sampling.columns; x += stride) {
      const pixel = averagePixel(pixels, sampling.columns, sampling.rows, x, y);
      const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
      const jitter = strokeJitter(x, y, "background", unit * 2.1);
      const direction = strokeDirection(pixels, sampling.columns, sampling.rows, x, y, "background");
      const centerX = bounds.x + (x + 0.5) * sampling.cellWidth + jitter.x;
      const centerY = bounds.y + (y + 0.5) * sampling.cellHeight + jitter.y;
      const length = unit * 4.1;
      const offsetX = Math.cos(direction) * length * 0.5;
      const offsetY = Math.sin(direction) * length * 0.5;
      actions.push({
        tool: "brush",
        pass: "background",
        label: `Underpainting stroke ${actions.length + 1}`,
        points: [centerX - offsetX, centerY - offsetY, centerX, centerY, centerX + offsetX, centerY + offsetY],
        stroke: toColor(perturbPixel(quantizePixel(pixel, 16), x, y, 8)),
        strokeWidth: Math.max(2, unit * 2.8),
        opacity: 0.32,
      });
    }
  }
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
  style: EditorPaintStyle,
  include: (pixel: Pixel, x: number, y: number) => boolean
) {
  for (let y = 0; y < sampling.rows; y += stride) {
    const rowOffset = (Math.floor(y / stride) % 2) * Math.max(1, Math.floor(stride / 2));
    for (let x = rowOffset; x < sampling.columns; x += stride) {
      const pixel = averagePixel(pixels, sampling.columns, sampling.rows, x, y);
      if (!include(pixel, x, y) || pixel.alpha < 32) {
        continue;
      }

          const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
      const color = toColor(style === "realistic" ? quantizePixel(pixel, unit <= 12 ? 16 : 24) : perturbPixel(quantizePixel(pixel, unit <= 12 ? 16 : 24), x, y, pass === "background" ? 10 : 6));
      const direction = strokeDirection(pixels, sampling.columns, sampling.rows, x, y, pass);
      const brushScale = adaptiveBrushScale(pass, localContrast(pixels, sampling.columns, sampling.rows, x, y));
      const length = unit * (pass === "background" ? 3.2 : pass === "major-forms" ? 2.55 : pass === "final-detail" || pass === "facial-features" ? 1.15 : 1.7);
      const jitter = strokeJitter(x, y, pass, unit * (style === "realistic" ? 1.25 : 1.75), style === "realistic" ? 0.44 : 0.62);
      const centerX = bounds.x + (x + 0.5) * sampling.cellWidth + jitter.x;
      const centerY = bounds.y + (y + 0.5) * sampling.cellHeight + jitter.y;
      const offsetX = Math.cos(direction) * length * 0.5;
      const offsetY = Math.sin(direction) * length * 0.5;
      const curveX = Math.cos(direction + Math.PI / 2) * length * 0.08;
      const curveY = Math.sin(direction + Math.PI / 2) * length * 0.08;
      actions.push({
        tool: "brush",
        pass,
        label: `${passLabel(pass)} stroke ${actions.length + 1}`,
        points: [centerX - offsetX, centerY - offsetY, centerX + curveX, centerY + curveY, centerX + offsetX, centerY + offsetY],
        stroke: color,
        strokeWidth: Math.max(1, unit * widthMultiplier * brushScale * (style === "realistic" ? 1 : 1.32)),
        opacity: style === "realistic" ? opacity : opacity * 0.74,
      });
    }
  }
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

function samplePlanningPixels(
  sourcePixels: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  sampling: { columns: number; rows: number }
) {
  const plannedPixels = new Uint8ClampedArray(sampling.columns * sampling.rows * 4);
  for (let y = 0; y < sampling.rows; y += 1) {
    for (let x = 0; x < sampling.columns; x += 1) {
      const left = Math.floor((x / sampling.columns) * sourceWidth);
      const right = Math.max(left, Math.ceil(((x + 1) / sampling.columns) * sourceWidth) - 1);
      const top = Math.floor((y / sampling.rows) * sourceHeight);
      const bottom = Math.max(top, Math.ceil(((y + 1) / sampling.rows) * sourceHeight) - 1);
      const samples = [
        getPixel(sourcePixels, sourceWidth, left, top),
        getPixel(sourcePixels, sourceWidth, right, top),
        getPixel(sourcePixels, sourceWidth, left, bottom),
        getPixel(sourcePixels, sourceWidth, right, bottom),
        getPixel(sourcePixels, sourceWidth, Math.round((left + right) / 2), Math.round((top + bottom) / 2)),
      ];
      const index = (y * sampling.columns + x) * 4;
      plannedPixels[index] = Math.round(samples.reduce((total, pixel) => total + pixel.red, 0) / samples.length);
      plannedPixels[index + 1] = Math.round(samples.reduce((total, pixel) => total + pixel.green, 0) / samples.length);
      plannedPixels[index + 2] = Math.round(samples.reduce((total, pixel) => total + pixel.blue, 0) / samples.length);
      plannedPixels[index + 3] = Math.round(samples.reduce((total, pixel) => total + pixel.alpha, 0) / samples.length);
    }
  }
  return plannedPixels;
}

type ReferencePyramid = {
  composition: { pixels: Uint8ClampedArray; columns: number; rows: number };
  forms: { pixels: Uint8ClampedArray; columns: number; rows: number };
  details: { pixels: Uint8ClampedArray; columns: number; rows: number };
};

function buildReferencePyramid(sourcePixels: Uint8ClampedArray, sourceWidth: number, sourceHeight: number): ReferencePyramid {
  return {
    composition: buildPyramidLevel(sourcePixels, sourceWidth, sourceHeight, 32),
    forms: buildPyramidLevel(sourcePixels, sourceWidth, sourceHeight, 64),
    details: buildPyramidLevel(sourcePixels, sourceWidth, sourceHeight, 128),
  };
}

function buildPyramidLevel(sourcePixels: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, maximumSide: number) {
  const scale = Math.min(1, maximumSide / Math.max(sourceWidth, sourceHeight));
  const columns = Math.max(1, Math.round(sourceWidth * scale));
  const rows = Math.max(1, Math.round(sourceHeight * scale));
  return { pixels: samplePlanningPixels(sourcePixels, sourceWidth, sourceHeight, { columns, rows }), columns, rows };
}

function samplePyramid(level: ReferencePyramid[keyof ReferencePyramid], x: number, y: number, columns: number, rows: number) {
  const levelX = Math.round((x / Math.max(1, columns - 1)) * Math.max(0, level.columns - 1));
  const levelY = Math.round((y / Math.max(1, rows - 1)) * Math.max(0, level.rows - 1));
  return sample(level.pixels, level.columns, level.rows, levelX, levelY);
}

function appendPainterlyReconstruction(
  actions: EditorAssistAction[],
  pixels: Uint8ClampedArray,
  pyramid: ReferencePyramid,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number },
  style: EditorPaintStyle
) {
  const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
  const candidates: Array<{ x: number; y: number; score: number }> = [];
  for (let y = 1; y < sampling.rows - 1; y += 2) {
    for (let x = 1; x < sampling.columns - 1; x += 2) {
      candidates.push({ x, y, score: reconstructionPriority(pixels, sampling.columns, sampling.rows, x, y) });
    }
  }
  candidates.sort((first, second) => second.score - first.score);

  const structureLimit = style === "oil" ? 360 : 280;
  for (const candidate of candidates.slice(0, structureLimit)) {
    const compositionColor = samplePyramid(pyramid.composition, candidate.x, candidate.y, sampling.columns, sampling.rows);
    const formColor = samplePyramid(pyramid.forms, candidate.x, candidate.y, sampling.columns, sampling.rows);
    const detailColor = samplePyramid(pyramid.details, candidate.x, candidate.y, sampling.columns, sampling.rows);
    const contrast = localContrast(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y);
    const direction = strokeDirection(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y, "major-forms");
    const jitter = strokeJitter(candidate.x, candidate.y, "major-forms", unit * 0.38, 0.26);
    const centerX = bounds.x + (candidate.x + 0.5) * sampling.cellWidth + jitter.x;
    const centerY = bounds.y + (candidate.y + 0.5) * sampling.cellHeight + jitter.y;
    const length = unit * (contrast > 90 ? 1.25 : 2.05);
    const offsetX = Math.cos(direction) * length * 0.5;
    const offsetY = Math.sin(direction) * length * 0.5;
    actions.push({
      tool: "brush",
      pass: "major-forms",
      label: "Structure reconstruction",
      points: [centerX - offsetX, centerY - offsetY, centerX, centerY, centerX + offsetX, centerY + offsetY],
      stroke: toColor(contrast > 90 ? detailColor : contrast > 35 ? formColor : compositionColor),
      strokeWidth: Math.max(1, unit * (contrast > 90 ? 0.58 : 0.95)),
      opacity: style === "oil" ? 0.72 : 0.64,
    });
  }

  const contourCandidates = candidates.filter((candidate) => isEdge(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y));
  for (const candidate of contourCandidates.slice(0, style === "oil" ? 220 : 180)) {
    const color = samplePyramid(pyramid.details, candidate.x, candidate.y, sampling.columns, sampling.rows);
    const direction = strokeDirection(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y, "final-detail");
    const centerX = bounds.x + (candidate.x + 0.5) * sampling.cellWidth;
    const centerY = bounds.y + (candidate.y + 0.5) * sampling.cellHeight;
    const length = unit * 1.1;
    const offsetX = Math.cos(direction) * length * 0.5;
    const offsetY = Math.sin(direction) * length * 0.5;
    actions.push({
      tool: "brush",
      pass: "final-detail",
      label: "Contour preservation",
      points: [centerX - offsetX, centerY - offsetY, centerX, centerY, centerX + offsetX, centerY + offsetY],
      stroke: toColor(color),
      strokeWidth: Math.max(1, unit * 0.32),
      opacity: 0.78,
    });
  }
}

function reconstructionPriority(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number) {
  const focalBonus = isFocalDetail(data, columns, rows, x, y) ? 220 : 0;
  const edgeBonus = isEdge(data, columns, rows, x, y) ? 125 : 0;
  const structure = refinementError(data, columns, rows, x, y);
  return structure + edgeBonus + focalBonus;
}

function isPainterlyStyle(style: EditorPaintStyle) {
  return style === "oil" || style === "watercolor";
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

function strokeJitter(x: number, y: number, pass: EditorPaintPass, unit: number, amplitude = 0.62) {
  const seed = x * 73856093 ^ y * 19349663 ^ pass.length * 83492791;
  const horizontal = ((seed >>> 5) % 1000) / 1000 - 0.5;
  const vertical = ((seed >>> 15) % 1000) / 1000 - 0.5;
  return { x: horizontal * unit * amplitude, y: vertical * unit * amplitude };
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
  bounds: { x: number; y: number; width: number; height: number },
  style: EditorPaintStyle
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
  }

  for (const feature of selected) {
    const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
    const direction = strokeDirection(pixels, sampling.columns, sampling.rows, feature.x, feature.y, "facial-features");
    const jitter = strokeJitter(feature.x, feature.y, "facial-features", style === "realistic" ? 0 : unit * 0.5);
    const centerX = bounds.x + (feature.x + 0.5) * sampling.cellWidth + jitter.x;
    const centerY = bounds.y + (feature.y + 0.5) * sampling.cellHeight + jitter.y;
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
      opacity: style === "realistic" ? 0.94 : 0.68,
    });
  }

  appendPortraitLandmark(actions, pixels, sampling, bounds, face, "left eye", 0.2, 0.12, 0.42);
  appendPortraitLandmark(actions, pixels, sampling, bounds, face, "right eye", 0.2, 0.58, 0.88);
  appendPortraitLandmark(actions, pixels, sampling, bounds, face, "mouth", 0.64, 0.5, 0.7);
}

function appendRefinementPass(
  actions: EditorAssistAction[],
  pixels: Uint8ClampedArray,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number },
  limit: number,
  style: EditorPaintStyle
) {
  const candidates: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  for (let y = 1; y < sampling.rows - 1; y += 2) {
    for (let x = 1; x < sampling.columns - 1; x += 2) {
      const pixel = averagePixel(pixels, sampling.columns, sampling.rows, x, y);
      const score = refinementPriority(pixels, sampling.columns, sampling.rows, x, y);
      if (score > 72) candidates.push({ x, y, score, pixel });
    }
  }

  candidates.sort((first, second) => second.score - first.score);
  const selected: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  for (const candidate of candidates) {
    if (selected.some((item) => Math.abs(item.x - candidate.x) < 3 && Math.abs(item.y - candidate.y) < 3)) continue;
    selected.push(candidate);
    if (selected.length === limit) break;
  }

  for (const candidate of selected) {
    const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
    const direction = strokeDirection(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y, "final-detail");
    const brushScale = adaptiveBrushScale("final-detail", localContrast(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y));
    const length = unit * 1.05 * brushScale;
    const jitter = strokeJitter(candidate.x, candidate.y, "final-detail", style === "realistic" ? 0 : unit * 0.65);
    const centerX = bounds.x + (candidate.x + 0.5) * sampling.cellWidth + jitter.x;
    const centerY = bounds.y + (candidate.y + 0.5) * sampling.cellHeight + jitter.y;
    const offsetX = Math.cos(direction) * length * 0.5;
    const offsetY = Math.sin(direction) * length * 0.5;
    actions.push({
      tool: "brush",
      pass: "final-detail",
      label: "Error refinement",
      points: [centerX - offsetX, centerY - offsetY, centerX, centerY, centerX + offsetX, centerY + offsetY],
      stroke: toColor(quantizePixel(candidate.pixel, 12)),
      strokeWidth: Math.max(1, unit * 0.38 * brushScale),
      opacity: style === "realistic" ? 0.88 : 0.6,
    });
  }
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
  return colorDistance(pixel, averageWindow(data, columns, rows, x, y, 4)) + localContrast(data, columns, rows, x, y) * 0.6;
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

function adaptiveBrushScale(pass: EditorPaintPass, contrast: number) {
  if (pass === "background") return contrast < 28 ? 1.28 : contrast > 90 ? 0.86 : 1.05;
  if (pass === "major-forms") return contrast > 100 ? 0.76 : contrast > 58 ? 0.92 : 1.12;
  if (pass === "shading") return contrast > 76 ? 0.84 : 1.04;
  return contrast > 100 ? 0.72 : 0.9;
}

function darkenPixel(pixel: Pixel, factor: number): Pixel {
  return { red: Math.round(pixel.red * factor), green: Math.round(pixel.green * factor), blue: Math.round(pixel.blue * factor), alpha: pixel.alpha };
}

function refinementPriority(data: Uint8ClampedArray, columns: number, rows: number, x: number, y: number) {
  const focalBonus = isFocalDetail(data, columns, rows, x, y) ? 190 : 0;
  const edgeBonus = isEdge(data, columns, rows, x, y) ? 85 : 0;
  const centralBonus = x > columns * 0.2 && x < columns * 0.8 && y > rows * 0.12 && y < rows * 0.7 ? 24 : 0;
  return refinementError(data, columns, rows, x, y) + focalBonus + edgeBonus + centralBonus;
}

function refinementLimit(detailLevel: EditorPaintDetailLevel) {
  return detailLevel === "study" ? 100 : detailLevel === "refined" ? 220 : 340;
}

function applyPaintingStyle(actions: EditorAssistAction[], style: EditorPaintStyle) {
  if (style === "realistic") return actions;
  return actions.map((action) => {
    if (action.tool !== "brush") return action;
    if (style === "oil") {
      return { ...action, strokeWidth: (action.strokeWidth || 1) * 1.18, opacity: Math.min(1, (action.opacity || 1) * 0.82) };
    }
    if (style === "watercolor") {
      return { ...action, strokeWidth: (action.strokeWidth || 1) * 1.35, opacity: Math.min(0.72, (action.opacity || 1) * 0.58) };
    }
    return { ...action, strokeWidth: Math.max(1, (action.strokeWidth || 1) * 0.68), opacity: Math.min(0.78, (action.opacity || 1) * 0.72) };
  });
}

function appendGlazePass(
  actions: EditorAssistAction[],
  pixels: Uint8ClampedArray,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number },
  limit: number
) {
  const candidates: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  for (let y = 1; y < sampling.rows - 1; y += 2) {
    for (let x = 1; x < sampling.columns - 1; x += 2) {
      if (isEdge(pixels, sampling.columns, sampling.rows, x, y) || isFocalDetail(pixels, sampling.columns, sampling.rows, x, y)) continue;
      const pixel = averagePixel(pixels, sampling.columns, sampling.rows, x, y);
      candidates.push({ x, y, score: refinementPriority(pixels, sampling.columns, sampling.rows, x, y), pixel });
    }
  }
  candidates.sort((first, second) => second.score - first.score);
  for (const candidate of candidates.slice(0, limit)) {
    const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
    const direction = strokeDirection(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y, "final-detail");
    const jitter = strokeJitter(candidate.x, candidate.y, "final-detail", unit * 1.1);
    const centerX = bounds.x + (candidate.x + 0.5) * sampling.cellWidth + jitter.x;
    const centerY = bounds.y + (candidate.y + 0.5) * sampling.cellHeight + jitter.y;
    const length = unit * 1.8;
    const offsetX = Math.cos(direction) * length * 0.5;
    const offsetY = Math.sin(direction) * length * 0.5;
    actions.push({
      tool: "brush",
      pass: "final-detail",
      label: "Blending glaze",
      points: [centerX - offsetX, centerY - offsetY, centerX, centerY, centerX + offsetX, centerY + offsetY],
      stroke: toColor(perturbPixel(quantizePixel(candidate.pixel, 12), candidate.x, candidate.y, 4)),
      strokeWidth: Math.max(1, unit * 0.45),
      opacity: 0.18,
    });
  }
}

function glazeLimit(detailLevel: EditorPaintDetailLevel) {
  return detailLevel === "study" ? 140 : detailLevel === "refined" ? 360 : 720;
}

function appendEdgeSharpeningPass(
  actions: EditorAssistAction[],
  pixels: Uint8ClampedArray,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number },
  style: EditorPaintStyle
) {
  const candidates: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  for (let y = 1; y < sampling.rows - 1; y += 1) {
    for (let x = 1; x < sampling.columns - 1; x += 1) {
      if (!isEdge(pixels, sampling.columns, sampling.rows, x, y)) continue;
      candidates.push({ x, y, score: reconstructionPriority(pixels, sampling.columns, sampling.rows, x, y), pixel: averagePixel(pixels, sampling.columns, sampling.rows, x, y) });
    }
  }
  candidates.sort((first, second) => second.score - first.score);
  const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
  for (const candidate of candidates.slice(0, style === "oil" ? 280 : 220)) {
    const direction = strokeDirection(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y, "final-detail");
    const centerX = bounds.x + (candidate.x + 0.5) * sampling.cellWidth;
    const centerY = bounds.y + (candidate.y + 0.5) * sampling.cellHeight;
    const length = unit * 0.86;
    const offsetX = Math.cos(direction) * length * 0.5;
    const offsetY = Math.sin(direction) * length * 0.5;
    actions.push({
      tool: "brush",
      pass: "final-detail",
      label: "Edge sharpening",
      points: [centerX - offsetX, centerY - offsetY, centerX, centerY, centerX + offsetX, centerY + offsetY],
      stroke: toColor(quantizePixel(candidate.pixel, 12)),
      strokeWidth: Math.max(1, unit * 0.22),
      opacity: style === "oil" ? 0.88 : 0.76,
    });
  }
}

function appendFeatureLockPass(
  actions: EditorAssistAction[],
  pixels: Uint8ClampedArray,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number },
  detailLevel: EditorPaintDetailLevel,
  style: EditorPaintStyle
) {
  const candidates: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  for (let y = Math.floor(sampling.rows * 0.12); y < Math.ceil(sampling.rows * 0.68); y += 1) {
    for (let x = Math.floor(sampling.columns * 0.18); x < Math.ceil(sampling.columns * 0.82); x += 1) {
      const pixel = averagePixel(pixels, sampling.columns, sampling.rows, x, y);
      const score = localContrast(pixels, sampling.columns, sampling.rows, x, y) + (isFocalDetail(pixels, sampling.columns, sampling.rows, x, y) ? 260 : 0);
      if (score > 90 && brightness(pixel) < 180) candidates.push({ x, y, score, pixel });
    }
  }
  candidates.sort((first, second) => second.score - first.score);
  const selected: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  const limit = detailLevel === "study" ? 80 : detailLevel === "refined" ? 180 : 300;
  for (const candidate of candidates) {
    if (selected.some((item) => Math.abs(item.x - candidate.x) < 2 && Math.abs(item.y - candidate.y) < 2)) continue;
    selected.push(candidate);
    if (selected.length === limit) break;
  }
  const unit = Math.min(sampling.cellWidth, sampling.cellHeight);
  for (const candidate of selected) {
    const direction = strokeDirection(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y, "facial-features");
    const centerX = bounds.x + (candidate.x + 0.5) * sampling.cellWidth;
    const centerY = bounds.y + (candidate.y + 0.5) * sampling.cellHeight;
    const length = Math.max(2, unit * 0.42);
    const offsetX = Math.cos(direction) * length * 0.5;
    const offsetY = Math.sin(direction) * length * 0.5;
    actions.push({
      tool: "brush",
      pass: "facial-features",
      label: "Locked feature detail",
      points: [centerX - offsetX, centerY - offsetY, centerX, centerY, centerX + offsetX, centerY + offsetY],
      stroke: toColor(darkenPixel(quantizePixel(candidate.pixel, 8), 0.72)),
      strokeWidth: Math.max(1, unit * 0.16),
      opacity: style === "oil" ? 0.92 : 0.82,
    });
  }
}

function appendMicroFeaturePass(
  actions: EditorAssistAction[],
  pixels: Uint8ClampedArray,
  sampling: { columns: number; rows: number; cellWidth: number; cellHeight: number },
  bounds: { x: number; y: number; width: number; height: number },
  detailLevel: EditorPaintDetailLevel,
  style: EditorPaintStyle
) {
  const candidates: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  const top = Math.floor(sampling.rows * 0.1);
  const bottom = Math.ceil(sampling.rows * 0.76);
  const left = Math.floor(sampling.columns * 0.12);
  const right = Math.ceil(sampling.columns * 0.88);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const pixel = sample(pixels, sampling.columns, sampling.rows, x, y);
      const contrast = localContrast(pixels, sampling.columns, sampling.rows, x, y);
      const focal = isFocalDetail(pixels, sampling.columns, sampling.rows, x, y);
      const edge = isEdge(pixels, sampling.columns, sampling.rows, x, y);
      if (!focal && !edge && contrast < 115) continue;
      candidates.push({ x, y, score: contrast + (focal ? 320 : 0) + (edge ? 160 : 0), pixel });
    }
  }
  candidates.sort((first, second) => second.score - first.score);
  const selected: Array<{ x: number; y: number; score: number; pixel: Pixel }> = [];
  const limit = detailLevel === "study" ? 160 : detailLevel === "refined" ? 520 : 1_100;
  for (const candidate of candidates) {
    if (selected.some((item) => Math.abs(item.x - candidate.x) < 1 && Math.abs(item.y - candidate.y) < 1)) continue;
    selected.push(candidate);
    if (selected.length === limit) break;
  }

  for (const candidate of selected) {
    const contrast = localContrast(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y);
    const direction = strokeDirection(pixels, sampling.columns, sampling.rows, candidate.x, candidate.y, "facial-features");
    const centerX = bounds.x + (candidate.x + 0.5) * sampling.cellWidth;
    const centerY = bounds.y + (candidate.y + 0.5) * sampling.cellHeight;
    const length = contrast > 170 ? 3 : 2;
    const offsetX = Math.cos(direction) * length * 0.5;
    const offsetY = Math.sin(direction) * length * 0.5;
    actions.push({
      tool: "brush",
      pass: "facial-features",
      label: "Micro feature refinement",
      points: [centerX - offsetX, centerY - offsetY, centerX, centerY, centerX + offsetX, centerY + offsetY],
      stroke: toColor(boostLocalContrast(candidate.pixel, contrast)),
      strokeWidth: 1,
      opacity: style === "oil" ? 0.96 : 0.86,
    });
  }
}

function boostLocalContrast(pixel: Pixel, contrast: number): Pixel {
  const factor = brightness(pixel) < 118 ? 0.72 : contrast > 150 ? 1.16 : 1.04;
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value * factor)));
  return { red: clamp(pixel.red), green: clamp(pixel.green), blue: clamp(pixel.blue), alpha: pixel.alpha };
}

function perturbPixel(pixel: Pixel, x: number, y: number, range: number): Pixel {
  const seed = x * 83492791 ^ y * 2654435761;
  const adjustment = ((seed >>> 10) % (range * 2 + 1)) - range;
  const clamp = (value: number) => Math.max(0, Math.min(255, value + adjustment));
  return { red: clamp(pixel.red), green: clamp(pixel.green), blue: clamp(pixel.blue), alpha: pixel.alpha };
}