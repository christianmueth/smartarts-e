import { callLLMResult } from "@/lib/aiClient";
import type { EditorAssistAction, EditorAssistLayerCandidate, EditorAssistPlan, EditorAssistSelectedLayer } from "@/types/easy-easel";

type EaselAssistInput = {
  prompt: string;
  document: {
    width: number;
    height: number;
    backgroundColor: string;
    layerCount: number;
  };
  layers?: EditorAssistLayerCandidate[];
  selectedLayer?: EditorAssistSelectedLayer | null;
};

type ExplanationSections = {
  summary: string;
  keyPoints: string[];
};

type MathSolution = {
  title: string;
  result: string;
  steps: string[];
};

type DoodleDecomposition = {
  subject: string;
  parts: string[];
};

type SketchStyle = {
  stroke: string;
  fill: string;
  accent: string;
  secondary: string;
  strokeWidth: number;
  scale: number;
  stretchX: number;
  stretchY: number;
  rough: boolean;
};

type SketchBuilder = (input: EaselAssistInput, style: SketchStyle) => EditorAssistPlan;

type SketchLexiconEntry = {
  nouns: string[];
  build: SketchBuilder;
  message: string;
};

const easelAssistSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["canvas"] },
    assistantMessage: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tool: { type: "string", enum: ["text", "rect", "ellipse", "brush", "eraser", "arrow"] },
          label: { type: "string" },
          text: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          fontSize: { type: "number" },
          color: { type: "string" },
          stroke: { type: "string" },
          fill: { type: "string" },
          strokeWidth: { type: "number" },
          points: {
            type: "array",
            items: { type: "number" },
          },
        },
        required: ["tool"],
      },
    },
  },
  required: ["mode", "assistantMessage", "actions"],
} as const;

export async function planEasyEaselAssist(input: EaselAssistInput): Promise<EditorAssistPlan> {
  const prompt = cleanText(input.prompt, 1600);
  if (isMathPrompt(prompt)) {
    const mathPlan = await buildMathCanvasPlan({ ...input, prompt });
    if (mathPlan) {
      return placeGeneratedPlan(mathPlan, { ...input, prompt });
    }
  }
  if (isExplanationPrompt(prompt)) {
    const explanationPlan = await buildExplanationCanvasPlan({ ...input, prompt });
    if (explanationPlan) {
      return placeGeneratedPlan(explanationPlan, { ...input, prompt });
    }
  }

  const heuristicPlan = buildHeuristicCanvasPlan({ ...input, prompt });
  if (heuristicPlan) {
    return placeGeneratedPlan(heuristicPlan, { ...input, prompt });
  }

  const decomposition = isDoodlePrompt(prompt) ? await generateDoodleDecomposition(prompt) : null;
  const llmPlan = await planWithLlm({ ...input, prompt }, decomposition);
  if (llmPlan) {
    return placeGeneratedPlan(llmPlan, { ...input, prompt });
  }

  if (isDoodlePrompt(prompt)) {
    return placeGeneratedPlan(buildGenericDoodleFallbackPlan({ ...input, prompt }), { ...input, prompt });
  }

  return placeGeneratedPlan(buildDeterministicFallbackCanvasPlan({ ...input, prompt }), { ...input, prompt });
}

async function buildMathCanvasPlan(input: EaselAssistInput): Promise<EditorAssistPlan | null> {
  const solution = await generateMathSolution(input.prompt) || buildDeterministicMathSolution(input.prompt);
  return solution ? buildMathSolutionLayout(input, solution) : null;
}

async function buildExplanationCanvasPlan(input: EaselAssistInput): Promise<EditorAssistPlan | null> {
  const topic = extractExplanationTopic(input.prompt) || "this topic";
  const sections = await generateExplanationSections(topic);
  const content = sections || buildDeterministicExplanationSections(topic);

  if (!content) {
    return null;
  }

  return buildExplanationLayout(input, topic, content);
}

async function planWithLlm(input: EaselAssistInput, decomposition: DoodleDecomposition | null = null): Promise<EditorAssistPlan | null> {
  const wantsDoodle = isDoodlePrompt(input.prompt);
  const selectedLayer = input.selectedLayer
    ? {
        id: input.selectedLayer.id,
        kind: input.selectedLayer.kind,
        name: input.selectedLayer.name,
        bounds: {
          x: round(input.selectedLayer.x),
          y: round(input.selectedLayer.y),
          width: round(input.selectedLayer.width),
          height: round(input.selectedLayer.height),
        },
      }
    : null;
  const layers = Array.isArray(input.layers)
    ? input.layers.slice(0, 24).map((layer) => ({
        id: layer.id,
        kind: layer.kind,
        name: layer.name,
        bounds: {
          x: round(layer.x),
          y: round(layer.y),
          width: round(layer.width),
          height: round(layer.height),
        },
      }))
    : [];

  const result = await callLLMResult(
    [
      {
        role: "system",
        content: [
          "You are an Easy Easel canvas assistant.",
          "Convert the prompt into direct easel tool actions only.",
          "Always use mode=canvas.",
          "Use only text, rect, ellipse, arrow, brush, or eraser.",
          "When asked to draw, doodle, sketch, make, create, or paint something, produce a recognizable drawing with 12-48 actions.",
          "Make drawings brush-led: use 8-36 brush actions for an outer contour, major structural features, repeated components, interior details, hatching, shadows, and highlights. Use rects or ellipses only as optional supporting parts.",
          "Use text only for a requested label, never as a substitute for the drawing. Do not return a generic symbol, abstract blob, or prompt card.",
          "Every brush action needs an ordered polyline of at least 4 points. Close the outer contour by repeating its first point at the end when appropriate. Every shape needs x, y, width, and height.",
          "Decompose unfamiliar objects into named parts: silhouette, major supports, repeated parts such as wheels or windows, and small identifying details before drawing.",
          "When a decomposition is supplied, create at least one labeled action for every listed part, using that exact part name in the action label.",
          "Compose the object around the center of the document, preserve recognizable proportions, and keep all marks inside the canvas.",
          "If the user references an existing item like 'my flower' or 'the second flower', use the selected layer bounds when present, otherwise use the supplied layer list.",
          "Keep all coordinates within the document bounds.",
          "If the request is too vague for a precise drawing, choose a minimal helpful markup action rather than switching modes.",
          "Do not return explanations outside the JSON schema.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt: input.prompt,
          document: input.document,
          decomposition,
          selectedLayer,
          layers,
        }),
      },
    ],
    900,
    0.2,
    {
      guidedJson: easelAssistSchema,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "easy_easel_assist_plan",
          schema: easelAssistSchema,
        },
      },
      timeoutMs: 20_000,
    }
  );

  if (!result.ok) {
    return null;
  }

  const parsed = safeJsonParse(result.content);
  const plan = normalizeAssistPlan(parsed, input.document);
  if (wantsDoodle && !isUsableDoodlePlan(plan, decomposition)) {
    return null;
  }
  return plan;
}

function buildHeuristicCanvasPlan(input: EaselAssistInput): EditorAssistPlan | null {
  const lower = input.prompt.toLowerCase();
  const targetLayer = resolveTargetLayer(input);
  const target = getTargetBounds(input.document, targetLayer);

  const sketchEntry = findSketchLexiconEntry(lower);
  if (sketchEntry) {
    return embellishSketchPlan(sketchEntry.build(input, extractSketchStyle(lower, sketchEntry.message)));
  }

  if (/(highlight|box|outline|frame)/.test(lower) && targetLayer) {
    return {
      mode: "canvas",
      assistantMessage: "Highlighting the selected element on the easel.",
      actions: [
        {
          tool: "rect",
          label: "Highlight",
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
          stroke: "#ff5fb2",
          fill: "rgba(255,95,178,0.14)",
          strokeWidth: 6,
        },
      ],
    };
  }

  if (/(circle|oval|ring around|encircle)/.test(lower) && targetLayer) {
    return {
      mode: "canvas",
      assistantMessage: "Circling the target on the easel.",
      actions: [
        {
          tool: "ellipse",
          label: "Circle",
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
          stroke: "#ff5fb2",
          fill: "rgba(255,95,178,0.08)",
          strokeWidth: 5,
        },
      ],
    };
  }

  if (/(arrow|point to|point at|call out)/.test(lower) && targetLayer) {
    const centerX = target.x + target.width / 2;
    const centerY = target.y + target.height / 2;
    const startX = clamp(target.x - Math.max(80, target.width * 0.3), 0, input.document.width);
    const startY = clamp(target.y - Math.max(60, target.height * 0.25), 0, input.document.height);
    return {
      mode: "canvas",
      assistantMessage: "Pointing to the target on the easel.",
      actions: [
        {
          tool: "arrow",
          label: "Arrow",
          points: buildArrowPoints(startX, startY, centerX, centerY),
          stroke: "#ff8a5b",
          strokeWidth: 8,
        },
      ],
    };
  }

  if (/(underline).*(rectangle|rect|box)|(?:rectangle|rect|box).*(underline)/.test(lower) && targetLayer) {
    return {
      mode: "canvas",
      assistantMessage: "Adding a rectangular underline on the easel.",
      actions: [
        {
          tool: "rect",
          label: "Underline",
          x: target.x,
          y: clamp(target.y + target.height + 12, 0, Math.max(0, input.document.height - 18)),
          width: target.width,
          height: 18,
          stroke: "#ff8a5b",
          fill: "rgba(255,138,91,0.2)",
          strokeWidth: 3,
        },
      ],
    };
  }

  if (/(underline|brush|stroke|mark beneath|line under)/.test(lower) && targetLayer) {
    const y = clamp(target.y + target.height + 18, 0, input.document.height);
    return {
      mode: "canvas",
      assistantMessage: "Brushing an underline onto the easel.",
      actions: [
        {
          tool: "brush",
          label: "Underline",
          points: [
            target.x,
            y,
            target.x + target.width * 0.35,
            y + 2,
            target.x + target.width * 0.7,
            y - 1,
            target.x + target.width,
            y + 1,
          ],
          stroke: "#ff8a5b",
          strokeWidth: 10,
        },
      ],
    };
  }

  if (/(erase|remove|clear)/.test(lower) && targetLayer) {
    const centerY = target.y + target.height / 2;
    return {
      mode: "canvas",
      assistantMessage: "Erasing across the selected area.",
      actions: [
        {
          tool: "eraser",
          label: "Erase",
          points: [
            target.x,
            centerY - target.height * 0.2,
            target.x + target.width * 0.35,
            centerY,
            target.x + target.width * 0.7,
            centerY - target.height * 0.1,
            target.x + target.width,
            centerY + target.height * 0.1,
          ],
          strokeWidth: Math.max(18, Math.round(target.height * 0.24)),
        },
      ],
    };
  }

  const requestedText = extractRequestedText(input.prompt);
  if (requestedText) {
    const width = clamp(requestedText.length * 24 + 120, 180, Math.max(220, input.document.width - 80));
    return {
      mode: "canvas",
      assistantMessage: "Writing text directly on the easel.",
      actions: [
        {
          tool: "text",
          label: "Text",
          text: requestedText,
          x: clamp(input.document.width / 2 - width / 2, 30, Math.max(30, input.document.width - width - 30)),
          y: clamp(targetLayer ? target.y - 72 : input.document.height * 0.18, 24, Math.max(24, input.document.height - 120)),
          width,
          fontSize: 42,
          color: "#7a1f4f",
        },
      ],
    };
  }

  return null;
}

async function generateExplanationSections(topic: string): Promise<ExplanationSections | null> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      keyPoints: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 4,
      },
    },
    required: ["summary", "keyPoints"],
  } as const;

  const result = await callLLMResult(
    [
      {
        role: "system",
        content: [
          "You write short, clear teaching explanations for an Easy Easel canvas.",
          "Return JSON only.",
          "Write one concise summary sentence and 3 brief sub-points.",
          "Every sentence must teach a concrete fact about the requested topic; never give generic advice about how to explain a topic.",
          "Use simple language, but keep the explanation correct and include important vocabulary when it helps.",
          "Make the sub-points cover mechanism, a key principle or example, and why the topic matters.",
          "Do not use markdown or numbering.",
          "Keep the total combined text under 520 characters.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Explain ${topic}.`,
      },
    ],
    340,
    0.3,
    {
      guidedJson: schema,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "easy_easel_explanation",
          schema,
        },
      },
      timeoutMs: 18_000,
    }
  );

  if (!result.ok) {
    return null;
  }

  const parsed = safeJsonParse(result.content);
  const normalized = normalizeExplanationSections(parsed, topic);
  return normalized;
}

async function generateMathSolution(prompt: string): Promise<MathSolution | null> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      result: { type: "string" },
      steps: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
    },
    required: ["title", "result", "steps"],
  } as const;
  const result = await callLLMResult(
    [
      {
        role: "system",
        content: [
          "You are a careful Easy Easel math tutor.",
          "Solve the user's math, calculus, or quantitative economics request and return JSON only.",
          "Use readable Unicode mathematical notation, not LaTeX or markdown. You may use +, −, ×, ÷, =, ≠, ≈, <, ≤, ≥, ±, ∞, √, π, ∑, ∏, ∫, ∂, ∆, ∇, ∈, ∉, ∪, ∩, ⊆, →, ↦, α, β, γ, θ, λ, μ, σ, and superscript characters such as ² and ³.",
          "Write calculus clearly in one line where possible, for example ∫₀² 3x² dx = [x³]₀² = 8, f′(x), ∂f/∂x, limₓ→a f(x), and ∑ₖ₌₁ⁿ k. Use Unicode subscripts for short bounds and indices when useful.",
          "Give a short title, a direct final result, and 2-5 concise working steps that show substitutions or algebra.",
          "For economics, state the relevant equation and interpret the numerical result when the prompt supplies enough data.",
          "Do not echo the request. If necessary information is missing, state exactly what is needed in the result and show the applicable formula in the steps.",
          "Keep all text under 700 characters.",
        ].join(" "),
      },
      { role: "user", content: prompt },
    ],
    520,
    0.1,
    {
      guidedJson: schema,
      responseFormat: { type: "json_schema", json_schema: { name: "easy_easel_math_solution", schema } },
      timeoutMs: 20_000,
    }
  );
  if (!result.ok) return null;
  return normalizeMathSolution(safeJsonParse(result.content));
}

async function generateDoodleDecomposition(prompt: string): Promise<DoodleDecomposition | null> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      subject: { type: "string" },
      parts: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 6 },
    },
    required: ["subject", "parts"],
  } as const;
  const result = await callLLMResult(
    [
      {
        role: "system",
        content: [
          "You are planning a simple, recognizable Easel doodle.",
          "Return JSON only.",
          "Identify the main visible object and list 4-6 concrete, drawable physical parts in drawing order.",
          "Use short singular noun phrases such as 'front wheel', 'frame', 'handlebar', 'window row', or 'roof'.",
          "Parts must make this specific object recognizable; never return generic terms like detail, accent, doodle, shape, or decoration.",
          "Do not include text labels or instructions.",
        ].join(" "),
      },
      { role: "user", content: prompt },
    ],
    180,
    0.1,
    {
      guidedJson: schema,
      responseFormat: { type: "json_schema", json_schema: { name: "easy_easel_doodle_parts", schema } },
      timeoutMs: 12_000,
    }
  );
  if (!result.ok) return null;
  return normalizeDoodleDecomposition(safeJsonParse(result.content));
}

function buildFlowerSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.42;
  const petalWidth = 96 * style.scale * style.stretchX;
  const petalHeight = 64 * style.scale * style.stretchY;
  const offsets = [
    { x: -56 * style.scale, y: -10 * style.scale },
    { x: 10 * style.scale, y: -56 * style.scale },
    { x: 76 * style.scale, y: -10 * style.scale },
    { x: 10 * style.scale, y: 36 * style.scale },
  ];

  return {
    mode: "canvas",
    assistantMessage: "Sketching a flower with easel tools.",
    actions: [
      ...offsets.map((offset, index) => ({
        tool: "ellipse" as const,
        label: `Petal ${index + 1}`,
        x: centerX + offset.x,
        y: centerY + offset.y,
        width: petalWidth,
        height: petalHeight,
        stroke: style.stroke,
        fill: style.fill,
        strokeWidth: style.strokeWidth,
      })),
      {
        tool: "ellipse",
        label: "Flower center",
        x: centerX + 14 * style.scale,
        y: centerY + 8 * style.scale,
        width: 48 * style.scale,
        height: 48 * style.scale,
        stroke: style.accent,
        fill: withAlpha(style.accent, 0.45),
        strokeWidth: style.strokeWidth,
      },
      {
        tool: "brush",
        label: "Stem",
        points: [
          centerX + 38 * style.scale,
          centerY + 54 * style.scale,
          centerX + 30 * style.scale,
          centerY + 126 * style.scale,
          centerX + 24 * style.scale,
          centerY + 188 * style.scale,
        ],
        stroke: style.secondary,
        strokeWidth: Math.max(6, style.strokeWidth + 2),
      },
      {
        tool: "brush",
        label: "Leaf",
        points: [
          centerX + 28 * style.scale,
          centerY + 150 * style.scale,
          centerX - 12 * style.scale,
          centerY + 168 * style.scale,
          centerX + 14 * style.scale,
          centerY + 186 * style.scale,
        ],
        stroke: style.secondary,
        strokeWidth: Math.max(5, style.strokeWidth + 1),
      },
    ],
  };
}

function buildHeartSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.38;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a heart with easel tools.",
    actions: [
      {
        tool: "brush",
        label: "Heart",
        points: [
          centerX,
          centerY + 110 * style.scale,
          centerX - 92 * style.scale * style.stretchX,
          centerY + 20 * style.scale,
          centerX - 54 * style.scale * style.stretchX,
          centerY - 48 * style.scale * style.stretchY,
          centerX,
          centerY - 2 * style.scale,
          centerX + 54 * style.scale * style.stretchX,
          centerY - 48 * style.scale * style.stretchY,
          centerX + 92 * style.scale * style.stretchX,
          centerY + 20 * style.scale,
          centerX,
          centerY + 110 * style.scale,
        ],
        stroke: style.stroke,
        strokeWidth: Math.max(6, style.strokeWidth + (style.rough ? 2 : 0)),
      },
    ],
  };
}

function buildSunSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.34;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a sun with easel tools.",
    actions: [
      {
        tool: "ellipse",
        label: "Sun",
        x: centerX - 54 * style.scale,
        y: centerY - 54 * style.scale,
        width: 108 * style.scale,
        height: 108 * style.scale,
        stroke: style.accent,
        fill: withAlpha(style.accent, 0.3),
        strokeWidth: Math.max(4, style.strokeWidth),
      },
      {
        tool: "brush",
        label: "Rays",
        points: [
          centerX,
          centerY - 92 * style.scale,
          centerX,
          centerY - 132 * style.scale,
          centerX + 62 * style.scale,
          centerY - 62 * style.scale,
          centerX + 90 * style.scale,
          centerY - 90 * style.scale,
          centerX + 92 * style.scale,
          centerY,
          centerX + 132 * style.scale,
          centerY,
          centerX + 62 * style.scale,
          centerY + 62 * style.scale,
          centerX + 90 * style.scale,
          centerY + 90 * style.scale,
          centerX,
          centerY + 92 * style.scale,
          centerX,
          centerY + 132 * style.scale,
          centerX - 62 * style.scale,
          centerY + 62 * style.scale,
          centerX - 90 * style.scale,
          centerY + 90 * style.scale,
          centerX - 92 * style.scale,
          centerY,
          centerX - 132 * style.scale,
          centerY,
          centerX - 62 * style.scale,
          centerY - 62 * style.scale,
          centerX - 90 * style.scale,
          centerY - 90 * style.scale,
        ],
        stroke: style.accent,
        strokeWidth: Math.max(4, style.strokeWidth),
      },
    ],
  };
}

function buildStarSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.34;
  const outer = 88 * style.scale;
  const inner = 36 * style.scale;
  const points: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
  }
  points.push(points[0], points[1]);

  return {
    mode: "canvas",
    assistantMessage: "Sketching a star with easel tools.",
    actions: [
      {
        tool: "brush",
        label: "Star",
        points,
        stroke: style.stroke,
        strokeWidth: Math.max(5, style.strokeWidth + 1),
      },
    ],
  };
}

function buildCloudSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.34;
  const puffWidth = 90 * style.scale * style.stretchX;
  const puffHeight = 62 * style.scale * style.stretchY;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a cloud with easel tools.",
    actions: [
      { tool: "ellipse", label: "Cloud puff 1", x: centerX - 120 * style.scale, y: centerY, width: puffWidth, height: puffHeight, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "ellipse", label: "Cloud puff 2", x: centerX - 46 * style.scale, y: centerY - 34 * style.scale, width: puffWidth, height: puffHeight, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "ellipse", label: "Cloud puff 3", x: centerX + 22 * style.scale, y: centerY - 6 * style.scale, width: puffWidth, height: puffHeight, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "rect", label: "Cloud base", x: centerX - 118 * style.scale, y: centerY + 26 * style.scale, width: 234 * style.scale * style.stretchX, height: 52 * style.scale, stroke: style.stroke, fill: withAlpha(style.stroke, 0.18), strokeWidth: style.strokeWidth },
    ],
  };
}

function buildMoonSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.32;
  const radius = 94 * style.scale;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a moon with easel tools.",
    actions: [
      { tool: "ellipse", label: "Moon outer", x: centerX - radius, y: centerY - radius, width: radius * 2, height: radius * 2, stroke: style.stroke, fill: withAlpha(style.accent, 0.28), strokeWidth: style.strokeWidth },
      { tool: "ellipse", label: "Moon cutout", x: centerX - radius * 0.2, y: centerY - radius, width: radius * 1.7, height: radius * 2, stroke: cleanColor(input.document.backgroundColor, "#ffffff"), fill: cleanColor(input.document.backgroundColor, "#ffffff"), strokeWidth: 1 },
    ],
  };
}

function buildTreeSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.34;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a tree with easel tools.",
    actions: [
      { tool: "rect", label: "Trunk", x: centerX - 22 * style.scale, y: centerY + 84 * style.scale, width: 44 * style.scale, height: 132 * style.scale, stroke: "#7a4b2a", fill: "rgba(122,75,42,0.3)", strokeWidth: Math.max(3, style.strokeWidth - 1) },
      { tool: "ellipse", label: "Canopy 1", x: centerX - 118 * style.scale, y: centerY - 10 * style.scale, width: 118 * style.scale, height: 92 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "ellipse", label: "Canopy 2", x: centerX - 50 * style.scale, y: centerY - 72 * style.scale, width: 118 * style.scale, height: 96 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "ellipse", label: "Canopy 3", x: centerX + 18 * style.scale, y: centerY - 8 * style.scale, width: 118 * style.scale, height: 92 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
    ],
  };
}

function buildLeafSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.38;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a leaf with easel tools.",
    actions: [
      { tool: "ellipse", label: "Leaf body", x: centerX - 84 * style.scale * style.stretchX, y: centerY - 56 * style.scale, width: 168 * style.scale * style.stretchX, height: 112 * style.scale * style.stretchY, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Leaf vein", points: [centerX - 64 * style.scale, centerY + 42 * style.scale, centerX - 10 * style.scale, centerY - 8 * style.scale, centerX + 70 * style.scale, centerY - 50 * style.scale], stroke: style.secondary, strokeWidth: Math.max(4, style.strokeWidth) },
    ],
  };
}

function buildAppleSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.38;
  return {
    mode: "canvas",
    assistantMessage: "Sketching an apple with easel tools.",
    actions: [
      { tool: "ellipse", label: "Apple left", x: centerX - 94 * style.scale, y: centerY - 42 * style.scale, width: 92 * style.scale, height: 104 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "ellipse", label: "Apple right", x: centerX - 4 * style.scale, y: centerY - 42 * style.scale, width: 92 * style.scale, height: 104 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Stem", points: [centerX, centerY - 30 * style.scale, centerX + 8 * style.scale, centerY - 74 * style.scale], stroke: "#7a4b2a", strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "brush", label: "Leaf", points: [centerX + 10 * style.scale, centerY - 70 * style.scale, centerX + 38 * style.scale, centerY - 94 * style.scale, centerX + 58 * style.scale, centerY - 68 * style.scale], stroke: style.secondary, strokeWidth: Math.max(4, style.strokeWidth) },
    ],
  };
}

function buildHouseSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.4;
  const width = 180 * style.scale * style.stretchX;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a house with easel tools.",
    actions: [
      { tool: "rect", label: "House body", x: centerX - width / 2, y: centerY, width, height: 132 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Roof", points: [centerX - width / 2 - 10, centerY, centerX, centerY - 104 * style.scale, centerX + width / 2 + 10, centerY], stroke: style.accent, strokeWidth: Math.max(5, style.strokeWidth + 1) },
      { tool: "rect", label: "Door", x: centerX - 22 * style.scale, y: centerY + 56 * style.scale, width: 44 * style.scale, height: 76 * style.scale, stroke: style.secondary, fill: withAlpha(style.secondary, 0.14), strokeWidth: Math.max(3, style.strokeWidth - 1) },
      { tool: "rect", label: "Window", x: centerX - 68 * style.scale, y: centerY + 30 * style.scale, width: 34 * style.scale, height: 34 * style.scale, stroke: style.secondary, fill: withAlpha(style.secondary, 0.1), strokeWidth: 2 },
      { tool: "rect", label: "Window", x: centerX + 34 * style.scale, y: centerY + 30 * style.scale, width: 34 * style.scale, height: 34 * style.scale, stroke: style.secondary, fill: withAlpha(style.secondary, 0.1), strokeWidth: 2 },
    ],
  };
}

function buildMountainSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const baseY = input.document.height * 0.58;
  const centerX = input.document.width * 0.5;
  return {
    mode: "canvas",
    assistantMessage: "Sketching mountains with easel tools.",
    actions: [
      { tool: "brush", label: "Back mountain", points: [centerX - 190 * style.scale, baseY + 34 * style.scale, centerX - 64 * style.scale, baseY - 120 * style.scale, centerX + 32 * style.scale, baseY + 26 * style.scale], stroke: style.secondary, strokeWidth: Math.max(5, style.strokeWidth + 1) },
      { tool: "brush", label: "Front mountain", points: [centerX - 54 * style.scale, baseY + 30 * style.scale, centerX + 72 * style.scale, baseY - 148 * style.scale, centerX + 214 * style.scale, baseY + 40 * style.scale], stroke: style.stroke, strokeWidth: Math.max(6, style.strokeWidth + 2) },
    ],
  };
}

function buildRainbowSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.6;
  const colors = ["#ff595e", "#ff924c", "#ffca3a", "#8ac926", "#1982c4"];
  return {
    mode: "canvas",
    assistantMessage: "Sketching a rainbow with easel tools.",
    actions: colors.map((color, index) => ({
      tool: "brush" as const,
      label: `Rainbow arc ${index + 1}`,
      points: buildArcPoints(centerX, centerY, (210 - index * 24) * style.scale, Math.PI, Math.PI * 2, 18),
      stroke: color,
      strokeWidth: Math.max(4, style.strokeWidth + 1),
    })),
  };
}

function buildBalloonSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.32;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a balloon with easel tools.",
    actions: [
      { tool: "ellipse", label: "Balloon", x: centerX - 54 * style.scale, y: centerY - 62 * style.scale, width: 108 * style.scale, height: 136 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "String", points: [centerX, centerY + 76 * style.scale, centerX - 14 * style.scale, centerY + 136 * style.scale, centerX + 4 * style.scale, centerY + 210 * style.scale], stroke: style.secondary, strokeWidth: Math.max(4, style.strokeWidth) },
    ],
  };
}

function buildSpeechBubbleSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.34;
  const width = 260 * style.scale * style.stretchX;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a speech bubble with easel tools.",
    actions: [
      { tool: "rect", label: "Bubble", x: centerX - width / 2, y: centerY - 50 * style.scale, width, height: 118 * style.scale * style.stretchY, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Bubble tail", points: [centerX - 32 * style.scale, centerY + 68 * style.scale, centerX - 4 * style.scale, centerY + 118 * style.scale, centerX + 26 * style.scale, centerY + 72 * style.scale], stroke: style.stroke, strokeWidth: Math.max(4, style.strokeWidth) },
    ],
  };
}

function buildLightningSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.26;
  return {
    mode: "canvas",
    assistantMessage: "Sketching lightning with easel tools.",
    actions: [
      { tool: "brush", label: "Lightning", points: [centerX - 24 * style.scale, centerY - 10 * style.scale, centerX + 18 * style.scale, centerY - 10 * style.scale, centerX - 2 * style.scale, centerY + 54 * style.scale, centerX + 34 * style.scale, centerY + 54 * style.scale, centerX - 42 * style.scale, centerY + 160 * style.scale], stroke: style.accent, strokeWidth: Math.max(6, style.strokeWidth + 2) },
    ],
  };
}

function buildBookSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.38;
  const width = 220 * style.scale * style.stretchX;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a book with easel tools.",
    actions: [
      { tool: "rect", label: "Left page", x: centerX - width / 2, y: centerY - 70 * style.scale, width: width / 2 - 6, height: 150 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "rect", label: "Right page", x: centerX + 6, y: centerY - 70 * style.scale, width: width / 2 - 6, height: 150 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Spine", points: [centerX, centerY - 70 * style.scale, centerX, centerY + 80 * style.scale], stroke: style.secondary, strokeWidth: Math.max(4, style.strokeWidth) },
    ],
  };
}

function buildFishSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.42;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a fish with easel tools.",
    actions: [
      { tool: "ellipse", label: "Fish body", x: centerX - 88 * style.scale, y: centerY - 44 * style.scale, width: 176 * style.scale * style.stretchX, height: 88 * style.scale * style.stretchY, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Tail", points: [centerX + 88 * style.scale, centerY, centerX + 144 * style.scale, centerY - 44 * style.scale, centerX + 144 * style.scale, centerY + 44 * style.scale, centerX + 88 * style.scale, centerY], stroke: style.stroke, strokeWidth: Math.max(5, style.strokeWidth) },
      { tool: "ellipse", label: "Eye", x: centerX - 50 * style.scale, y: centerY - 10 * style.scale, width: 14 * style.scale, height: 14 * style.scale, stroke: style.secondary, fill: withAlpha(style.secondary, 0.35), strokeWidth: 2 },
    ],
  };
}

function buildButterflySketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.38;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a butterfly with easel tools.",
    actions: [
      { tool: "ellipse", label: "Wing 1", x: centerX - 118 * style.scale, y: centerY - 70 * style.scale, width: 96 * style.scale, height: 110 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "ellipse", label: "Wing 2", x: centerX + 22 * style.scale, y: centerY - 70 * style.scale, width: 96 * style.scale, height: 110 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "ellipse", label: "Wing 3", x: centerX - 100 * style.scale, y: centerY + 14 * style.scale, width: 82 * style.scale, height: 88 * style.scale, stroke: style.accent, fill: withAlpha(style.accent, 0.22), strokeWidth: style.strokeWidth },
      { tool: "ellipse", label: "Wing 4", x: centerX + 18 * style.scale, y: centerY + 14 * style.scale, width: 82 * style.scale, height: 88 * style.scale, stroke: style.accent, fill: withAlpha(style.accent, 0.22), strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Body", points: [centerX, centerY - 64 * style.scale, centerX, centerY + 110 * style.scale], stroke: style.secondary, strokeWidth: Math.max(5, style.strokeWidth + 1) },
    ],
  };
}

function buildSmileySketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.34;
  const radius = 96 * style.scale;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a smiley face with easel tools.",
    actions: [
      { tool: "ellipse", label: "Face", x: centerX - radius, y: centerY - radius, width: radius * 2, height: radius * 2, stroke: style.accent, fill: withAlpha(style.accent, 0.3), strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "ellipse", label: "Eye 1", x: centerX - 42 * style.scale, y: centerY - 18 * style.scale, width: 16 * style.scale, height: 16 * style.scale, stroke: style.secondary, fill: withAlpha(style.secondary, 0.3), strokeWidth: 2 },
      { tool: "ellipse", label: "Eye 2", x: centerX + 26 * style.scale, y: centerY - 18 * style.scale, width: 16 * style.scale, height: 16 * style.scale, stroke: style.secondary, fill: withAlpha(style.secondary, 0.3), strokeWidth: 2 },
      { tool: "brush", label: "Smile", points: buildArcPoints(centerX, centerY + 12 * style.scale, 48 * style.scale, 0.15 * Math.PI, 0.85 * Math.PI, 12), stroke: style.stroke, strokeWidth: Math.max(4, style.strokeWidth) },
    ],
  };
}

function buildFlagSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.34;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a flag with easel tools.",
    actions: [
      { tool: "brush", label: "Pole", points: [centerX - 70 * style.scale, centerY - 84 * style.scale, centerX - 70 * style.scale, centerY + 140 * style.scale], stroke: style.secondary, strokeWidth: Math.max(5, style.strokeWidth) },
      { tool: "brush", label: "Flag", points: [centerX - 68 * style.scale, centerY - 80 * style.scale, centerX + 36 * style.scale, centerY - 62 * style.scale, centerX - 2 * style.scale, centerY - 22 * style.scale, centerX + 34 * style.scale, centerY + 12 * style.scale, centerX - 68 * style.scale, centerY + 6 * style.scale], stroke: style.stroke, strokeWidth: Math.max(5, style.strokeWidth + 1) },
    ],
  };
}

function buildRocketSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.32;
  return {
    mode: "canvas",
    assistantMessage: "Sketching a rocket with easel tools.",
    actions: [
      { tool: "ellipse", label: "Rocket body", x: centerX - 44 * style.scale, y: centerY - 72 * style.scale, width: 88 * style.scale, height: 180 * style.scale, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Left fin", points: [centerX - 44 * style.scale, centerY + 56 * style.scale, centerX - 86 * style.scale, centerY + 104 * style.scale, centerX - 28 * style.scale, centerY + 92 * style.scale], stroke: style.accent, strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "brush", label: "Right fin", points: [centerX + 44 * style.scale, centerY + 56 * style.scale, centerX + 86 * style.scale, centerY + 104 * style.scale, centerX + 28 * style.scale, centerY + 92 * style.scale], stroke: style.accent, strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "ellipse", label: "Window", x: centerX - 16 * style.scale, y: centerY - 18 * style.scale, width: 32 * style.scale, height: 32 * style.scale, stroke: style.secondary, fill: withAlpha(style.secondary, 0.2), strokeWidth: 2 },
      { tool: "brush", label: "Flame", points: [centerX, centerY + 108 * style.scale, centerX - 20 * style.scale, centerY + 154 * style.scale, centerX, centerY + 138 * style.scale, centerX + 20 * style.scale, centerY + 154 * style.scale, centerX, centerY + 108 * style.scale], stroke: "#ff924c", strokeWidth: Math.max(5, style.strokeWidth + 1) },
    ],
  };
}

function buildCarSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.4;
  const bodyWidth = 260 * style.scale * style.stretchX;
  const bodyHeight = 88 * style.scale * style.stretchY;
  const wheelSize = 58 * style.scale;
  const bodyX = centerX - bodyWidth / 2;
  const bodyY = centerY;
  const wheelY = bodyY + bodyHeight - wheelSize * 0.42;
  const leftWheelX = bodyX + bodyWidth * 0.18;
  const rightWheelX = bodyX + bodyWidth * 0.66;
  const roofY = bodyY - 76 * style.scale;

  return {
    mode: "canvas",
    assistantMessage: "Doodling a car with easel tools.",
    actions: [
      { tool: "rect", label: "Car body", x: bodyX, y: bodyY, width: bodyWidth, height: bodyHeight, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Car roof", points: [bodyX + bodyWidth * 0.22, bodyY, bodyX + bodyWidth * 0.36, roofY, bodyX + bodyWidth * 0.68, roofY, bodyX + bodyWidth * 0.82, bodyY], stroke: style.stroke, strokeWidth: Math.max(5, style.strokeWidth + 1) },
      { tool: "brush", label: "Bumper", points: [bodyX + 12 * style.scale, bodyY + bodyHeight * 0.72, bodyX - 12 * style.scale, bodyY + bodyHeight * 0.76, bodyX + 12 * style.scale, bodyY + bodyHeight * 0.84], stroke: style.accent, strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "ellipse", label: "Left wheel", x: leftWheelX, y: wheelY, width: wheelSize, height: wheelSize, stroke: style.secondary, fill: withAlpha(style.secondary, 0.3), strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "ellipse", label: "Right wheel", x: rightWheelX, y: wheelY, width: wheelSize, height: wheelSize, stroke: style.secondary, fill: withAlpha(style.secondary, 0.3), strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "ellipse", label: "Left hub", x: leftWheelX + wheelSize * 0.32, y: wheelY + wheelSize * 0.32, width: wheelSize * 0.36, height: wheelSize * 0.36, stroke: style.accent, fill: withAlpha(style.accent, 0.45), strokeWidth: 2 },
      { tool: "ellipse", label: "Right hub", x: rightWheelX + wheelSize * 0.32, y: wheelY + wheelSize * 0.32, width: wheelSize * 0.36, height: wheelSize * 0.36, stroke: style.accent, fill: withAlpha(style.accent, 0.45), strokeWidth: 2 },
    ],
  };
}

function buildBuildingSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.3;
  const width = 210 * style.scale * style.stretchX;
  const height = 270 * style.scale * style.stretchY;
  const x = centerX - width / 2;
  const y = centerY;
  const windowWidth = width * 0.18;
  const windowHeight = height * 0.13;
  return {
    mode: "canvas",
    assistantMessage: "Doodling a building with easel tools.",
    actions: [
      { tool: "rect", label: "Building facade", x, y, width, height, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth },
      { tool: "brush", label: "Roof line", points: [x - 12 * style.scale, y, centerX, y - 34 * style.scale, x + width + 12 * style.scale, y], stroke: style.accent, strokeWidth: Math.max(5, style.strokeWidth) },
      { tool: "brush", label: "Building side", points: [x + width, y, x + width + 26 * style.scale, y + 24 * style.scale, x + width + 26 * style.scale, y + height + 12 * style.scale, x + width, y + height], stroke: style.secondary, strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "rect", label: "Door", x: centerX - width * 0.12, y: y + height * 0.67, width: width * 0.24, height: height * 0.33, stroke: style.secondary, fill: withAlpha(style.secondary, 0.16), strokeWidth: 3 },
      { tool: "rect", label: "Window 1", x: x + width * 0.16, y: y + height * 0.19, width: windowWidth, height: windowHeight, stroke: style.accent, fill: withAlpha(style.accent, 0.18), strokeWidth: 3 },
      { tool: "rect", label: "Window 2", x: x + width * 0.64, y: y + height * 0.19, width: windowWidth, height: windowHeight, stroke: style.accent, fill: withAlpha(style.accent, 0.18), strokeWidth: 3 },
      { tool: "rect", label: "Window 3", x: x + width * 0.16, y: y + height * 0.43, width: windowWidth, height: windowHeight, stroke: style.accent, fill: withAlpha(style.accent, 0.18), strokeWidth: 3 },
      { tool: "rect", label: "Window 4", x: x + width * 0.64, y: y + height * 0.43, width: windowWidth, height: windowHeight, stroke: style.accent, fill: withAlpha(style.accent, 0.18), strokeWidth: 3 },
      { tool: "brush", label: "Ground line", points: [x - 36 * style.scale, y + height + 14 * style.scale, centerX, y + height + 20 * style.scale, x + width + 46 * style.scale, y + height + 14 * style.scale], stroke: style.secondary, strokeWidth: 4 },
    ],
  };
}

function buildMotorcycleSketchPlan(input: EaselAssistInput, style: SketchStyle): EditorAssistPlan {
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.45;
  const scale = style.scale;
  const wheel = 62 * scale;
  const leftWheelX = centerX - 122 * scale;
  const rightWheelX = centerX + 60 * scale;
  const wheelY = centerY + 60 * scale;
  return {
    mode: "canvas",
    assistantMessage: "Doodling a motorcycle with easel tools.",
    actions: [
      { tool: "ellipse", label: "Rear wheel", x: leftWheelX, y: wheelY, width: wheel, height: wheel, stroke: style.secondary, fill: withAlpha(style.secondary, 0.2), strokeWidth: Math.max(5, style.strokeWidth) },
      { tool: "ellipse", label: "Front wheel", x: rightWheelX, y: wheelY, width: wheel, height: wheel, stroke: style.secondary, fill: withAlpha(style.secondary, 0.2), strokeWidth: Math.max(5, style.strokeWidth) },
      { tool: "brush", label: "Frame", points: [leftWheelX + wheel * 0.5, wheelY + wheel * 0.5, centerX - 22 * scale, centerY + 32 * scale, centerX + 38 * scale, centerY + 70 * scale, rightWheelX + wheel * 0.5, wheelY + wheel * 0.5], stroke: style.stroke, strokeWidth: Math.max(6, style.strokeWidth + 1) },
      { tool: "brush", label: "Fuel tank", points: [centerX - 26 * scale, centerY + 34 * scale, centerX - 2 * scale, centerY - 10 * scale, centerX + 58 * scale, centerY + 8 * scale, centerX + 38 * scale, centerY + 70 * scale], stroke: style.stroke, strokeWidth: Math.max(6, style.strokeWidth) },
      { tool: "brush", label: "Seat", points: [centerX - 74 * scale, centerY + 8 * scale, centerX - 12 * scale, centerY + 2 * scale, centerX + 4 * scale, centerY + 20 * scale, centerX - 58 * scale, centerY + 28 * scale], stroke: style.accent, strokeWidth: Math.max(5, style.strokeWidth) },
      { tool: "brush", label: "Fork and handlebar", points: [rightWheelX + wheel * 0.5, wheelY + wheel * 0.5, centerX + 82 * scale, centerY + 10 * scale, centerX + 106 * scale, centerY - 34 * scale, centerX + 72 * scale, centerY - 38 * scale], stroke: style.secondary, strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "brush", label: "Exhaust", points: [centerX - 52 * scale, centerY + 48 * scale, centerX - 92 * scale, centerY + 76 * scale, leftWheelX + wheel * 0.3, wheelY + wheel * 0.68], stroke: style.accent, strokeWidth: Math.max(4, style.strokeWidth) },
      { tool: "ellipse", label: "Headlight", x: centerX + 90 * scale, y: centerY - 44 * scale, width: 22 * scale, height: 22 * scale, stroke: style.accent, fill: withAlpha(style.accent, 0.45), strokeWidth: 3 },
    ],
  };
}

function buildDeterministicFallbackCanvasPlan(input: EaselAssistInput): EditorAssistPlan {
  if (isDoodlePrompt(input.prompt)) {
    return buildGenericDoodleFallbackPlan(input);
  }
  const subject = extractSubjectLabel(input.prompt) || "Canvas note";
  const boxWidth = clamp(Math.max(260, subject.length * 20 + 120), 260, Math.max(260, input.document.width - 80));
  const x = clamp(input.document.width / 2 - boxWidth / 2, 24, Math.max(24, input.document.width - boxWidth - 24));
  const y = clamp(input.document.height * 0.18, 24, Math.max(24, input.document.height - 220));

  return {
    mode: "canvas",
    assistantMessage: "Translating the prompt into easel markup tools.",
    actions: [
      { tool: "rect", label: "Prompt box", x, y, width: boxWidth, height: 108, stroke: "#ff8a5b", fill: "rgba(255,241,196,0.58)", strokeWidth: 4 },
      { tool: "text", label: "Prompt note", text: subject, x: x + 24, y: y + 26, width: boxWidth - 48, fontSize: 36, color: "#7a1f4f" },
      { tool: "brush", label: "Accent underline", points: [x + 22, y + 86, x + boxWidth * 0.42, y + 90, x + boxWidth * 0.78, y + 84, x + boxWidth - 22, y + 88], stroke: "#ff5fb2", strokeWidth: 7 },
    ],
  };
}

function buildGenericDoodleFallbackPlan(input: EaselAssistInput): EditorAssistPlan {
  const subject = extractSubjectLabel(input.prompt) || "Doodle";
  const seed = hashText(input.prompt);
  const centerX = input.document.width * 0.5;
  const centerY = input.document.height * 0.44;
  const size = Math.min(input.document.width, input.document.height) * 0.24;
  const stroke = ["#ff5fb2", "#4d8cff", "#2ca24f", "#e84a5f"][seed % 4];
  const accent = ["#ffb200", "#ff8a5b", "#5abf9a", "#8e6cff"][Math.floor(seed / 7) % 4];
  const secondary = ["#174a8b", "#7a1f4f", "#1d6b3d", "#7a4b2a"][Math.floor(seed / 19) % 4];
  const left = centerX - size * 0.62;
  const right = centerX + size * 0.62;
  const top = centerY - size * 0.58;
  const bottom = centerY + size * 0.58;

  return {
    mode: "canvas",
    assistantMessage: `Sketching an expressive brush study for ${subject}.`,
    actions: [
      { tool: "brush", label: "Outer silhouette", points: [left, centerY + size * 0.12, left + size * 0.12, top + size * 0.16, centerX - size * 0.08, top, right - size * 0.12, top + size * 0.2, right, centerY + size * 0.06, right - size * 0.14, bottom - size * 0.04, centerX + size * 0.08, bottom, left + size * 0.06, bottom - size * 0.12, left, centerY + size * 0.12], stroke, strokeWidth: 8 },
      { tool: "brush", label: "Primary structure", points: [left + size * 0.14, centerY + size * 0.08, centerX - size * 0.16, centerY - size * 0.26, centerX + size * 0.22, centerY - size * 0.12, right - size * 0.16, centerY + size * 0.14], stroke: accent, strokeWidth: 7 },
      { tool: "brush", label: "Cross structure", points: [centerX - size * 0.42, centerY + size * 0.3, centerX - size * 0.04, centerY + size * 0.06, centerX + size * 0.36, centerY + size * 0.32], stroke: secondary, strokeWidth: 6 },
      { tool: "brush", label: "Interior contour", points: [centerX - size * 0.22, centerY - size * 0.18, centerX + size * 0.04, centerY - size * 0.28, centerX + size * 0.28, centerY - size * 0.02, centerX + size * 0.08, centerY + size * 0.2], stroke, strokeWidth: 5 },
      { tool: "brush", label: "Detail stroke 1", points: [centerX - size * 0.32, centerY + size * 0.18, centerX - size * 0.1, centerY + size * 0.02, centerX + size * 0.1, centerY + size * 0.16], stroke: accent, strokeWidth: 4 },
      { tool: "brush", label: "Detail stroke 2", points: [centerX - size * 0.02, centerY - size * 0.34, centerX + size * 0.12, centerY - size * 0.48, centerX + size * 0.28, centerY - size * 0.32], stroke: secondary, strokeWidth: 4 },
      { tool: "brush", label: "Hatching", points: [left + size * 0.22, bottom - size * 0.28, left + size * 0.42, bottom - size * 0.12, left + size * 0.34, bottom - size * 0.38, left + size * 0.56, bottom - size * 0.18, left + size * 0.5, bottom - size * 0.46, left + size * 0.72, bottom - size * 0.26], stroke: secondary, strokeWidth: 3 },
      { tool: "brush", label: "Hatching accent", points: [centerX + size * 0.18, centerY + size * 0.14, centerX + size * 0.42, centerY + size * 0.32, centerX + size * 0.24, centerY + size * 0.28, centerX + size * 0.46, centerY + size * 0.46], stroke, strokeWidth: 3 },
      { tool: "brush", label: "Contour accent", points: [left + size * 0.08, centerY + size * 0.4, centerX - size * 0.2, bottom - size * 0.04, centerX + size * 0.16, bottom - size * 0.08], stroke: accent, strokeWidth: 4 },
      { tool: "brush", label: "Fine detail", points: [centerX - size * 0.1, centerY - size * 0.02, centerX + size * 0.04, centerY + size * 0.08, centerX - size * 0.02, centerY + size * 0.24], stroke: secondary, strokeWidth: 3 },
      { tool: "brush", label: "Highlight", points: [left + size * 0.14, top + size * 0.26, centerX - size * 0.06, top + size * 0.1, centerX + size * 0.12, top + size * 0.16], stroke: "#ffffff", strokeWidth: 4 },
      { tool: "brush", label: "Ground shadow", points: [left - size * 0.02, bottom + size * 0.08, centerX - size * 0.22, bottom + size * 0.14, centerX + size * 0.22, bottom + size * 0.1, right + size * 0.04, bottom + size * 0.14], stroke: secondary, strokeWidth: 5 },
    ],
  };
}

function embellishSketchPlan(plan: EditorAssistPlan): EditorAssistPlan {
  const bounds = getActionBounds(plan.actions);
  if (!bounds) return plan;
  const x = bounds.x;
  const y = bounds.y;
  const width = bounds.width;
  const height = bounds.height;
  return {
    ...plan,
    actions: [
      ...plan.actions,
      { tool: "brush", label: "Grounding shadow", points: [x - width * 0.06, y + height + 18, x + width * 0.28, y + height + 25, x + width * 0.68, y + height + 19, x + width * 1.06, y + height + 24], stroke: "#6d5561", strokeWidth: 4 },
      { tool: "brush", label: "Sketch hatching", points: [x + width * 0.18, y + height * 0.74, x + width * 0.31, y + height * 0.62, x + width * 0.28, y + height * 0.82, x + width * 0.43, y + height * 0.67, x + width * 0.4, y + height * 0.87, x + width * 0.56, y + height * 0.72], stroke: "#7a1f4f", strokeWidth: 3 },
      { tool: "brush", label: "Sketch highlight", points: [x + width * 0.2, y + height * 0.2, x + width * 0.42, y + height * 0.12, x + width * 0.62, y + height * 0.18], stroke: "#ffffff", strokeWidth: 3 },
    ],
  };
}

function buildExplanationLayout(
  input: EaselAssistInput,
  topic: string,
  content: ExplanationSections
): EditorAssistPlan {
  const document = input.document;
  const width = clamp(Math.min(document.width - 80, 760), 320, document.width - 40);
  const title = toTitleText(topic) || "Explanation";
  const bodyLines = splitCanvasText(formatExplanationText(content), 58);
  const cardHeight = Math.max(196, 106 + bodyLines.length * 34);
  const placement = resolveTeachingPlacement(input, width, cardHeight);
  const x = placement.x;
  const y = placement.y;

  return {
    mode: "canvas",
    assistantMessage: `Writing a clear explanation of ${topic}.`,
    actions: [
    {
      tool: "rect",
      label: "Explanation text box",
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
      text: title,
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
    ],
  };
}

function buildMathSolutionLayout(
  input: EaselAssistInput,
  solution: MathSolution,
): EditorAssistPlan {
  const document = input.document;
  const width = clamp(Math.min(document.width - 80, 820), 340, document.width - 40);
  const body = [`Result: ${solution.result}`, ...solution.steps.map((step, index) => `${index + 1}. ${step}`)].join("\n");
  const bodyLines = splitCanvasText(body, 58);
  const cardHeight = Math.max(210, 110 + bodyLines.length * 34);
  const placement = resolveTeachingPlacement(input, width, cardHeight);
  const x = placement.x;
  const y = placement.y;
  return {
    mode: "canvas",
    assistantMessage: `Working through ${solution.title}.`,
    actions: [
      { tool: "rect", label: "Math solution box", x, y, width, height: cardHeight, stroke: "#4d8cff", fill: "rgba(226,242,255,0.94)", strokeWidth: 4 },
      { tool: "text", label: "Math title", text: solution.title, x: x + 24, y: y + 22, width: width - 48, fontSize: 32, color: "#174a8b" },
      { tool: "text", label: "Math working", text: bodyLines.join("\n"), x: x + 24, y: y + 82, width: width - 48, fontSize: 22, color: "#15385f" },
    ],
  };
}

function placeGeneratedPlan(plan: EditorAssistPlan, input: EaselAssistInput): EditorAssistPlan {
  const bounds = getActionBounds(plan.actions);
  if (!bounds) return plan;
  const placement = resolveUnoccupiedPlacement(input, bounds.width, bounds.height);
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

function resolveUnoccupiedPlacement(input: EaselAssistInput, width: number, height: number) {
  const document = input.document;
  const padding = 28;
  const maxX = Math.max(padding, document.width - width - padding);
  const maxY = Math.max(padding, document.height - height - padding);
  const occupied = (input.layers || []).map((layer) => ({
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
  }));
  const requested = readRequestedLocation(input.prompt);
  const requestedPosition = requested
    ? {
        x: requested.horizontal === "left" ? padding : requested.horizontal === "right" ? maxX : (document.width - width) / 2,
        y: requested.vertical === "top" ? padding : requested.vertical === "bottom" ? maxY : (document.height - height) / 2,
      }
    : null;
  const positions = requestedPosition ? [requestedPosition] : [];
  const steps = 4;
  for (let row = 0; row <= steps; row += 1) {
    for (let column = 0; column <= steps; column += 1) {
      positions.push({
        x: padding + (maxX - padding) * (column / steps),
        y: padding + (maxY - padding) * (row / steps),
      });
    }
  }

  const candidates = positions.map((position) => ({
    x: Math.round(clamp(position.x, padding, maxX)),
    y: Math.round(clamp(position.y, padding, maxY)),
  }));
  const openCandidate = candidates.find((position) => !occupied.some((bounds) => intersectsBounds({ ...position, width, height }, bounds)));
  if (openCandidate) return openCandidate;

  return candidates.reduce((best, candidate) => (
    overlapArea({ ...candidate, width, height }, occupied) < overlapArea({ ...best, width, height }, occupied)
      ? candidate
      : best
  ));
}

function resolveTeachingPlacement(input: EaselAssistInput, width: number, height: number) {
  return resolveUnoccupiedPlacement(input, width, height);
}

function intersectsBounds(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function overlapArea(
  candidate: { x: number; y: number; width: number; height: number },
  occupied: Array<{ x: number; y: number; width: number; height: number }>
) {
  return occupied.reduce((area, bounds) => {
    const width = Math.max(0, Math.min(candidate.x + candidate.width, bounds.x + bounds.width) - Math.max(candidate.x, bounds.x));
    const height = Math.max(0, Math.min(candidate.y + candidate.height, bounds.y + bounds.height) - Math.max(candidate.y, bounds.y));
    return area + width * height;
  }, 0);
}

function readRequestedLocation(prompt: string) {
  const lower = prompt.toLowerCase();
  const horizontal = /\b(?:top|upper|bottom|lower)?\s*(?:left|left-hand)\b/.test(lower) ? "left"
    : /\b(?:top|upper|bottom|lower)?\s*(?:right|right-hand)\b/.test(lower) ? "right"
      : /\b(?:center|centre|middle)\b/.test(lower) ? "center" : null;
  const vertical = /\b(?:top|upper)\b/.test(lower) ? "top"
    : /\b(?:bottom|lower)\b/.test(lower) ? "bottom"
      : /\b(?:center|centre|middle)\b/.test(lower) ? "center" : null;
  return horizontal || vertical ? { horizontal: horizontal || "center", vertical: vertical || "center" } : null;
}

function getActionBounds(actions: EditorAssistAction[]) {
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
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function extractRequestedText(prompt: string) {
  const quoted = prompt.match(/["“]([^"”]{1,80})["”]/);
  if (quoted?.[1]) {
    return cleanText(quoted[1], 80);
  }

  const messageMatch = prompt.match(/(?:write|type|add|place|show|put|generate)\s+(?:a|an|the)?\s*([a-z0-9 ,.!?'’-]{1,60}?)\s+(?:message|text|note|label)\b/i);
  if (messageMatch?.[1]) {
    return toTitleText(messageMatch[1]);
  }

  if (/\bhello\b/i.test(prompt)) {
    return "Hello";
  }

  return null;
}

function extractExplanationTopic(prompt: string) {
  const cleaned = cleanText(prompt, 1200);
  const direct = cleaned.match(/^(?:explain|describe|summarize|teach me|tell me about|what is|how does|how do|why does|why do)\s+(.+)$/i);
  if (direct?.[1]) {
    return direct[1].replace(/[?.!]+$/g, "").trim();
  }

  const contains = cleaned.match(/(?:about|of)\s+(.+)$/i);
  if (contains?.[1] && isExplanationPrompt(cleaned)) {
    return contains[1].replace(/[?.!]+$/g, "").trim();
  }

  return null;
}

function isExplanationPrompt(prompt: string) {
  return /^(?:explain|describe|summarize|teach me|tell me about|what is|how does|how do|why does|why do)\b/i.test(prompt.trim());
}

function isMathPrompt(prompt: string) {
  return /(?:\d\s*[a-z]?\s*[+\-*/^=]|\b(?:solve|equation|derivative|differentiate|integral|integrate|limit|calculus|elasticity|marginal|supply|demand|revenue|cost|profit|interest|percentage)\b)/i.test(prompt);
}

function isDoodlePrompt(prompt: string) {
  return /\b(?:draw|doodle|sketch|paint|make|create|illustrate)\b/i.test(prompt);
}

function isUsableDoodlePlan(plan: EditorAssistPlan | null, decomposition: DoodleDecomposition | null) {
  if (!plan || plan.actions.length < 12 || plan.actions.length > 48) return false;
  const brushActions = plan.actions.filter((action) => action.tool === "brush");
  if (brushActions.length < 8 || brushActions.length > 36) return false;
  if (!brushActions.every((action) => Array.isArray(action.points) && action.points.length >= 8)) return false;
  if (!decomposition) return true;
  const labels = plan.actions.map((action) => String(action.label || "").toLowerCase());
  return decomposition.parts.every((part) => {
    const normalizedPart = part.toLowerCase();
    return labels.some((label) => label.includes(normalizedPart) || normalizedPart.includes(label));
  });
}

function normalizeDoodleDecomposition(value: unknown): DoodleDecomposition | null {
  const record = asRecord(value);
  const subject = cleanText(record.subject, 80);
  const parts = Array.isArray(record.parts)
    ? Array.from(new Set(record.parts.map((part) => cleanText(part, 48)).filter(Boolean))).slice(0, 6)
    : [];
  const hasGenericPart = parts.some((part) => /^(?:detail|accent|doodle|shape|decoration|object|part)$/i.test(part));
  if (!subject || parts.length < 4 || hasGenericPart) return null;
  return { subject, parts };
}

function normalizeMathSolution(value: unknown): MathSolution | null {
  const record = asRecord(value);
  const title = cleanCanvasParagraph(record.title as string);
  const result = cleanCanvasParagraph(record.result as string);
  const steps = Array.isArray(record.steps)
    ? record.steps.map((step) => cleanCanvasParagraph(step)).filter(Boolean).slice(0, 5)
    : [];
  if (!title || !result || steps.length < 2) return null;
  return { title, result, steps };
}

function buildDeterministicMathSolution(prompt: string): MathSolution | null {
  const compact = prompt.replace(/\s+/g, " ").trim();
  const linear = compact.match(/(?:solve\s*)?([+-]?\s*\d*)\s*x\s*([+-]\s*\d+)?\s*=\s*([+-]?\s*\d+(?:\.\d+)?)/i);
  if (linear) {
    const coefficientText = linear[1].replace(/\s/g, "");
    const coefficient = coefficientText === "" || coefficientText === "+" ? 1 : coefficientText === "-" ? -1 : Number(coefficientText);
    const constant = Number((linear[2] || "0").replace(/\s/g, ""));
    const rightSide = Number(linear[3]);
    if (Number.isFinite(coefficient) && coefficient !== 0 && Number.isFinite(constant) && Number.isFinite(rightSide)) {
      const numerator = rightSide - constant;
      const value = numerator / coefficient;
      return {
        title: "Solve for x",
        result: `x = ${Number.isInteger(value) ? value : Number(value.toFixed(4))}`,
        steps: [
          `Start with ${coefficient}x ${constant >= 0 ? "+" : "-"} ${Math.abs(constant)} = ${rightSide}.`,
          `Subtract ${constant} from both sides: ${coefficient}x = ${numerator}.`,
          `Divide both sides by ${coefficient}.`,
        ],
      };
    }
  }

  if (/fundamental theorem of calculus|\bftc\b|definite integral/i.test(compact)) {
    return {
      title: "Fundamental Theorem of Calculus",
      result: "If F′(x) = f(x), then ∫ₐᵇ f(x) dx = F(b) − F(a).",
      steps: [
        "Find an antiderivative F(x) for the integrand f(x).",
        "Evaluate F at the upper bound b.",
        "Subtract the lower-bound value: F(b) − F(a).",
        "Example: ∫₀² 3x² dx = [x³]₀² = 8.",
      ],
    };
  }

  if (/\b(?:derivative|differentiate)\b/i.test(compact)) {
    return {
      title: "Derivative method",
      result: "For c·xⁿ, d/dx[c·xⁿ] = c·n·xⁿ⁻¹.",
      steps: ["Differentiate each term separately.", "Multiply the coefficient by the exponent n.", "Reduce the exponent by 1, then simplify constants."],
    };
  }

  if (/\b(?:elasticity|supply|demand|revenue|cost|profit|marginal)\b/i.test(compact)) {
    return {
      title: "Economics calculation setup",
      result: "Choose the equation, substitute the data, then interpret sign, units, and size.",
      steps: ["Profit: π = TR − TC.", "Marginal revenue: MR = dTR/dQ; marginal cost: MC = dTC/dQ.", "Elasticity: Eₚ = (%∆Q)/(%∆P); |Eₚ| > 1 is elastic and |Eₚ| < 1 is inelastic."],
    };
  }

  return null;
}

function extractSubjectLabel(prompt: string) {
  const cleaned = cleanText(prompt, 90)
    .replace(/^(draw|make|create|generate|sketch|paint|add|show)\s+/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .trim();
  if (!cleaned) return null;
  const shortened = cleaned.length > 48 ? `${cleaned.slice(0, 45).trim()}...` : cleaned;
  return shortened.charAt(0).toUpperCase() + shortened.slice(1);
}

function normalizeAssistPlan(value: unknown, document: EaselAssistInput["document"]): EditorAssistPlan | null {
  const record = asRecord(value);
  const mode = record.mode === "canvas" ? record.mode : null;
  if (!mode) return null;

  const assistantMessage = cleanText(record.assistantMessage, 200) || "Applying easel tools.";
  const actions = Array.isArray(record.actions)
    ? record.actions.map((action) => normalizeAction(action, document)).filter(Boolean) as EditorAssistAction[]
    : [];

  if (!actions.length) {
    return null;
  }

  return {
    mode,
    assistantMessage,
    actions,
  };
}

function normalizeAction(value: unknown, document: EaselAssistInput["document"]): EditorAssistAction | null {
  const record = asRecord(value);
  const tool = record.tool;
  if (tool !== "text" && tool !== "rect" && tool !== "ellipse" && tool !== "brush" && tool !== "eraser" && tool !== "arrow") {
    return null;
  }

  if (tool === "text") {
    const text = cleanText(record.text, 160);
    if (!text) return null;
    const width = clamp(asNumber(record.width, 360), 120, document.width);
    return {
      tool,
      label: cleanText(record.label, 80) || "Text",
      text,
      x: clamp(asNumber(record.x, document.width / 2 - width / 2), 0, Math.max(0, document.width - width)),
      y: clamp(asNumber(record.y, document.height * 0.2), 0, Math.max(0, document.height - 60)),
      width,
      fontSize: clamp(asNumber(record.fontSize, 40), 18, 120),
      color: cleanColor(record.color, "#7a1f4f"),
    };
  }

  if (tool === "rect" || tool === "ellipse") {
    const width = clamp(asNumber(record.width, 220), 20, document.width);
    const height = clamp(asNumber(record.height, 120), 8, document.height);
    return {
      tool,
      label: cleanText(record.label, 80) || (tool === "ellipse" ? "Ellipse" : "Rectangle"),
      x: clamp(asNumber(record.x, document.width / 2 - width / 2), 0, Math.max(0, document.width - width)),
      y: clamp(asNumber(record.y, document.height / 2 - height / 2), 0, Math.max(0, document.height - height)),
      width,
      height,
      stroke: cleanColor(record.stroke, "#ff5fb2"),
      fill: cleanFill(record.fill, "rgba(255,95,178,0.12)"),
      strokeWidth: clamp(asNumber(record.strokeWidth, 4), 1, 24),
    };
  }

  const points = normalizePoints(record.points, document);
  if (points.length < 4) return null;

  return {
    tool,
    label: cleanText(record.label, 80) || (tool === "eraser" ? "Erase" : tool === "arrow" ? "Arrow" : "Brush"),
    points: tool === "arrow" && points.length >= 4 ? buildArrowPoints(points[0], points[1], points[points.length - 2], points[points.length - 1]) : points,
    stroke: tool === "eraser" ? "#ffffff" : cleanColor(record.stroke, tool === "arrow" ? "#ff8a5b" : "#ff8a5b"),
    strokeWidth: clamp(asNumber(record.strokeWidth, tool === "eraser" ? 24 : tool === "arrow" ? 8 : 8), 2, 80),
  };
}

function resolveTargetLayer(input: EaselAssistInput) {
  const layers = Array.isArray(input.layers) ? input.layers : [];
  const prompt = input.prompt.toLowerCase();
  if (input.selectedLayer && /(selected|this|that|current|my)/.test(prompt)) {
    return input.selectedLayer;
  }

  const ordinal = readOrdinalIndex(prompt);
  const filteredByName = filterLayersByPrompt(layers, prompt);
  if (ordinal !== null) {
    const ordered = filteredByName.length ? filteredByName : layers;
    const candidate = ordered[ordinal] || null;
    if (candidate) return candidate;
  }

  if (filteredByName.length) {
    return filteredByName[0];
  }

  if (/\b(last|latest|top)\b/.test(prompt)) {
    return layers[0] || input.selectedLayer || null;
  }

  if (/\b(first|bottom|earliest)\b/.test(prompt)) {
    return layers[layers.length - 1] || input.selectedLayer || null;
  }

  return input.selectedLayer || layers[0] || null;
}

function filterLayersByPrompt(layers: EditorAssistLayerCandidate[], prompt: string) {
  const tokens = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !STOP_WORDS.has(token));
  if (!tokens.length) return [];

  return layers.filter((layer) => {
    const haystack = `${layer.name} ${layer.kind}`.toLowerCase();
    return tokens.some((token) => haystack.includes(token));
  });
}

function readOrdinalIndex(prompt: string) {
  if (/\bfirst\b/.test(prompt)) return 0;
  if (/\bsecond\b/.test(prompt)) return 1;
  if (/\bthird\b/.test(prompt)) return 2;
  if (/\bfourth\b/.test(prompt)) return 3;
  const numeric = prompt.match(/\b(\d+)(?:st|nd|rd|th)\b/);
  if (!numeric) return null;
  return Math.max(0, Number(numeric[1]) - 1);
}

function buildArrowPoints(x1: number, y1: number, x2: number, y2: number) {
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

function buildArcPoints(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number, segments: number) {
  const points: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const angle = startAngle + (endAngle - startAngle) * t;
    points.push(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
  }
  return points;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "this",
  "that",
  "please",
  "to",
  "at",
  "on",
  "with",
  "using",
  "use",
  "make",
  "add",
  "draw",
  "put",
  "show",
  "highlight",
  "underline",
  "circle",
  "box",
  "around",
  "under",
  "over",
  "point",
  "arrow",
  "erase",
  "remove",
  "clear",
  "message",
  "text",
  "note",
  "label",
]);

function normalizePoints(value: unknown, document: EaselAssistInput["document"]) {
  if (!Array.isArray(value)) return [];
  const next: number[] = [];
  for (let index = 0; index < value.length - 1; index += 2) {
    next.push(clamp(asNumber(value[index], 0), 0, document.width));
    next.push(clamp(asNumber(value[index + 1], 0), 0, document.height));
  }
  return next;
}

function getTargetBounds(document: EaselAssistInput["document"], selectedLayer?: EditorAssistSelectedLayer | null) {
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
    x: clamp(selectedLayer.x - pad, 0, document.width),
    y: clamp(selectedLayer.y - pad, 0, document.height),
    width: clamp(selectedLayer.width + pad * 2, 12, document.width),
    height: clamp(selectedLayer.height + pad * 2, 12, document.height),
  };
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toTitleText(value: string) {
  const cleaned = cleanText(value, 80).replace(/\b(on|onto|with|using|for)\b.*$/i, "").trim();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown, maxLength = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanColor(value: unknown, fallback: string) {
  const cleaned = String(value || "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(cleaned) ? cleaned : fallback;
}

function cleanFill(value: unknown, fallback: string) {
  const cleaned = String(value || "").trim();
  return cleaned || fallback;
}

function asNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function buildDeterministicExplanation(topic: string) {
  return buildDeterministicExplanationSections(topic).summary;
}

function cleanCanvasParagraph(value: string) {
  return cleanText(String(value || "").replace(/\s*\n\s*/g, " "), 420);
}

function splitCanvasText(value: string, maxLineLength: number) {
  const lines: string[] = [];
  const paragraphs = String(value || "").split(/\n+/).map((paragraph) => cleanCanvasParagraph(paragraph)).filter(Boolean);
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
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
    if (current) lines.push(current);
  }
  return lines.slice(0, 16);
}

function normalizeExplanationSections(value: unknown, topic: string): ExplanationSections | null {
  const record = asRecord(value);
  const summary = cleanCanvasParagraph(record.summary as string);
  const keyPoints = Array.isArray(record.keyPoints)
    ? record.keyPoints.map((point) => cleanCanvasParagraph(point)).filter(Boolean).slice(0, 4)
    : [];
  const text = [summary, ...keyPoints].join(" ").toLowerCase();
  const topicText = topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const isRequestEcho = topicText.length > 4 && (text === topicText || text.startsWith(`explain ${topicText}`));
  const isGenericTemplate = /easiest to understand|start with the core definition|break the process or structure|why the topic is important/.test(text);
  if (!summary || keyPoints.length < 2 || isRequestEcho || isGenericTemplate) {
    return null;
  }
  return { summary, keyPoints };
}

function formatExplanationText(content: ExplanationSections) {
  return [content.summary, ...content.keyPoints.map((point) => `• ${point}`)].join("\n");
}

function buildDeterministicExplanationSections(topic: string): ExplanationSections {
  if (/photosynthesis/i.test(topic)) {
    return {
      summary: "Photosynthesis is how plants use sunlight to make sugar for energy and growth.",
      keyPoints: [
        "Plants absorb water through their roots and carbon dioxide from the air.",
        "Light energy powers a reaction in the leaves that turns those inputs into sugar.",
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

  if (/newton.?s laws?|motion|force/i.test(topic)) {
    return {
      summary: "Newton's laws describe how forces change an object's motion.",
      keyPoints: [
        "Without a net force, an object stays at rest or continues moving at constant speed in a straight line.",
        "A larger net force causes more acceleration, while a larger mass is harder to accelerate.",
        "For every action force there is an equal and opposite reaction force on another object.",
      ],
    };
  }

  if (/cellular respiration|respiration/i.test(topic)) {
    return {
      summary: "Cellular respiration releases usable energy from food so cells can do work.",
      keyPoints: [
        "Cells break down glucose in a series of reactions, usually using oxygen in the mitochondria.",
        "The released energy is captured in ATP, a molecule cells use to power many processes.",
        "Carbon dioxide and water are produced as waste products during aerobic respiration.",
      ],
    };
  }

  if (/evolution|natural selection/i.test(topic)) {
    return {
      summary: "Evolution is the change in inherited traits of populations over many generations.",
      keyPoints: [
        "Individuals vary, and some of that variation is inherited by their offspring.",
        "Natural selection favors traits that help organisms survive or reproduce in a particular environment.",
        "Over time, helpful inherited traits can become more common in the population.",
      ],
    };
  }

  if (/atom|atomic structure/i.test(topic)) {
    return {
      summary: "An atom is the smallest unit of an element that still has that element's chemical identity.",
      keyPoints: [
        "A dense nucleus contains positively charged protons and neutral neutrons.",
        "Negatively charged electrons occupy regions around the nucleus and influence chemical bonding.",
        "The number of protons determines the element, while electrons can change how it reacts.",
      ],
    };
  }

  if (/mitosis|cell division/i.test(topic)) {
    return {
      summary: "Mitosis is the process that produces two genetically matching body cells from one original cell.",
      keyPoints: [
        "Before division, the cell copies its DNA so each new cell can receive a full set of chromosomes.",
        "The chromosomes separate into two groups as the cell organizes the copied genetic material.",
        "Mitosis supports growth, tissue repair, and replacement of worn-out cells.",
      ],
    };
  }

  const normalized = toTitleText(topic) || topic;
  return {
    summary: `${normalized} is easiest to understand by focusing on what it is, how it works, and why it matters.`,
    keyPoints: [
      "Start with the core definition so the main idea is clear.",
      "Break the process or structure into simple parts or steps.",
      "End with the outcome, use, or reason the topic is important.",
    ],
  };
}

function findSketchLexiconEntry(prompt: string) {
  return SKETCH_LEXICON.find((entry) => entry.nouns.some((noun) => new RegExp(`\\b${escapeRegExp(noun)}\\b`, "i").test(prompt))) || null;
}

function extractSketchStyle(prompt: string, message: string): SketchStyle {
  const style: SketchStyle = {
    stroke: "#ff5fb2",
    fill: "rgba(255,182,214,0.42)",
    accent: "#ffb200",
    secondary: "#2ca24f",
    strokeWidth: 4,
    scale: 1,
    stretchX: 1,
    stretchY: 1,
    rough: false,
  };

  if (/big|large|giant|huge/.test(prompt)) style.scale = 1.25;
  if (/small|tiny|mini/.test(prompt)) style.scale = 0.82;
  if (/wide|fat|broad/.test(prompt)) style.stretchX = 1.22;
  if (/tall|long/.test(prompt)) style.stretchY = 1.22;
  if (/thin|slim|narrow/.test(prompt)) style.stretchX = 0.82;
  if (/bright|sunny|glowing/.test(prompt)) {
    style.stroke = "#ff8a00";
    style.fill = "rgba(255,191,71,0.38)";
    style.accent = "#ffd84d";
  }
  if (/dark|moody|night/.test(prompt)) {
    style.stroke = "#4b3f72";
    style.fill = "rgba(75,63,114,0.2)";
    style.accent = "#2f274d";
  }
  if (/pastel|soft/.test(prompt)) {
    style.stroke = "#d970b7";
    style.fill = "rgba(255,210,230,0.42)";
    style.accent = "#ffd166";
  }
  if (/blue|azure|sky/.test(prompt)) {
    style.stroke = "#4d8cff";
    style.fill = "rgba(137,180,255,0.28)";
    style.accent = "#8ed2ff";
  }
  if (/green|leafy|forest/.test(prompt)) {
    style.stroke = "#2ca24f";
    style.fill = "rgba(122,212,139,0.28)";
    style.accent = "#7ed957";
    style.secondary = "#1f7a36";
  }
  if (/red|crimson|scarlet/.test(prompt)) {
    style.stroke = "#e84a5f";
    style.fill = "rgba(232,74,95,0.22)";
    style.accent = "#ff9f43";
  }
  if (/gold|golden|yellow/.test(prompt) || /sun/.test(message)) {
    style.stroke = "#ffb200";
    style.fill = "rgba(255,214,82,0.3)";
    style.accent = "#ffcf33";
  }
  if (/rough|messy|sketchy|hand drawn/.test(prompt)) {
    style.rough = true;
    style.strokeWidth += 2;
  }
  if (/bold|thick/.test(prompt)) style.strokeWidth += 2;
  if (/delicate|fine/.test(prompt)) style.strokeWidth = Math.max(2, style.strokeWidth - 1);

  return style;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withAlpha(color: string, alpha: number) {
  const hex = color.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `rgba(255,95,178,${alpha})`;
  }
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

const SKETCH_LEXICON: SketchLexiconEntry[] = [
  { nouns: ["flower", "petal", "daisy", "rose", "tulip", "sunflower"], build: buildFlowerSketchPlan, message: "flower" },
  { nouns: ["heart", "love"], build: buildHeartSketchPlan, message: "heart" },
  { nouns: ["sun", "sunshine"], build: buildSunSketchPlan, message: "sun" },
  { nouns: ["star", "sparkle"], build: buildStarSketchPlan, message: "star" },
  { nouns: ["cloud", "puff", "cumulus"], build: buildCloudSketchPlan, message: "cloud" },
  { nouns: ["moon", "crescent"], build: buildMoonSketchPlan, message: "moon" },
  { nouns: ["tree", "oak", "pine"], build: buildTreeSketchPlan, message: "tree" },
  { nouns: ["leaf", "leaves", "frond"], build: buildLeafSketchPlan, message: "leaf" },
  { nouns: ["apple", "fruit"], build: buildAppleSketchPlan, message: "apple" },
  { nouns: ["house", "home", "cabin"], build: buildHouseSketchPlan, message: "house" },
  { nouns: ["mountain", "peak", "hill"], build: buildMountainSketchPlan, message: "mountain" },
  { nouns: ["rainbow", "arc"], build: buildRainbowSketchPlan, message: "rainbow" },
  { nouns: ["balloon"], build: buildBalloonSketchPlan, message: "balloon" },
  { nouns: ["speech bubble", "chat bubble", "bubble"], build: buildSpeechBubbleSketchPlan, message: "speech bubble" },
  { nouns: ["lightning", "bolt", "thunderbolt"], build: buildLightningSketchPlan, message: "lightning" },
  { nouns: ["book", "notebook", "journal"], build: buildBookSketchPlan, message: "book" },
  { nouns: ["fish"], build: buildFishSketchPlan, message: "fish" },
  { nouns: ["butterfly"], build: buildButterflySketchPlan, message: "butterfly" },
  { nouns: ["smiley", "smile", "face"], build: buildSmileySketchPlan, message: "smiley" },
  { nouns: ["flag", "banner", "pennant"], build: buildFlagSketchPlan, message: "flag" },
  { nouns: ["rocket", "spaceship"], build: buildRocketSketchPlan, message: "rocket" },
  { nouns: ["car", "automobile", "vehicle", "sedan"], build: buildCarSketchPlan, message: "car" },
  { nouns: ["building", "skyscraper", "office", "tower", "apartment"], build: buildBuildingSketchPlan, message: "building" },
  { nouns: ["motorcycle", "motorbike", "bike"], build: buildMotorcycleSketchPlan, message: "motorcycle" },
];