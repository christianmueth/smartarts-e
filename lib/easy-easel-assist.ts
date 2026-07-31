import { callLLMResult } from "@/lib/aiClient";
import type { EditorAssistAction, EditorAssistPlan, EditorAssistSelectedLayer } from "@/types/easy-easel";

type EaselAssistInput = {
  prompt: string;
  document: {
    width: number;
    height: number;
    backgroundColor: string;
    layerCount: number;
  };
  selectedLayer?: EditorAssistSelectedLayer | null;
};

const easelAssistSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["canvas", "image"] },
    assistantMessage: { type: "string" },
    imagePrompt: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tool: { type: "string", enum: ["text", "rect", "brush", "eraser"] },
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
  const heuristicPlan = buildHeuristicCanvasPlan({ ...input, prompt });
  if (heuristicPlan) {
    return heuristicPlan;
  }

  const llmPlan = await planWithLlm({ ...input, prompt });
  if (llmPlan) {
    return llmPlan;
  }

  return {
    mode: "image",
    assistantMessage: "Creating an image layer for the easel.",
    actions: [],
    imagePrompt: prompt,
  };
}

async function planWithLlm(input: EaselAssistInput): Promise<EditorAssistPlan | null> {
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

  const result = await callLLMResult(
    [
      {
        role: "system",
        content: [
          "You are an Easy Easel canvas assistant.",
          "Decide whether the prompt should be handled with direct canvas tools or with image generation.",
          "Use mode=canvas when the user is asking to write text, annotate, box, highlight, underline, mark up, brush, or erase directly on the easel.",
          "Use mode=image only when the user is asking for a new standalone image that cannot be reasonably created with text, rect, brush, or eraser tools.",
          "When using canvas mode, return 1-4 concrete actions using only text, rect, brush, or eraser.",
          "If the user references an existing item like 'my flower', use the selected layer bounds when present.",
          "Keep all coordinates within the document bounds.",
          "Do not return explanations outside the JSON schema.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt: input.prompt,
          document: input.document,
          selectedLayer,
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
  return normalizeAssistPlan(parsed, input.document);
}

function buildHeuristicCanvasPlan(input: EaselAssistInput): EditorAssistPlan | null {
  const lower = input.prompt.toLowerCase();
  const target = getTargetBounds(input.document, input.selectedLayer);

  if (/(highlight|box|outline|frame)/.test(lower) && input.selectedLayer) {
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

  if (/(underline).*(rectangle|rect|box)|(?:rectangle|rect|box).*(underline)/.test(lower) && input.selectedLayer) {
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

  if (/(underline|brush|stroke|mark beneath|line under)/.test(lower) && input.selectedLayer) {
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

  if (/(erase|remove|clear)/.test(lower) && input.selectedLayer) {
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
          y: clamp(input.selectedLayer ? target.y - 72 : input.document.height * 0.18, 24, Math.max(24, input.document.height - 120)),
          width,
          fontSize: 42,
          color: "#7a1f4f",
        },
      ],
    };
  }

  return null;
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

function normalizeAssistPlan(value: unknown, document: EaselAssistInput["document"]): EditorAssistPlan | null {
  const record = asRecord(value);
  const mode = record.mode === "canvas" || record.mode === "image" ? record.mode : null;
  if (!mode) return null;

  const assistantMessage = cleanText(record.assistantMessage, 200) || (mode === "canvas" ? "Applying easel tools." : "Creating an image layer.");
  const imagePrompt = cleanText(record.imagePrompt, 1600) || undefined;
  const actions = Array.isArray(record.actions)
    ? record.actions.map((action) => normalizeAction(action, document)).filter(Boolean) as EditorAssistAction[]
    : [];

  if (mode === "canvas" && !actions.length) {
    return null;
  }

  return {
    mode,
    assistantMessage,
    actions,
    ...(imagePrompt ? { imagePrompt } : {}),
  };
}

function normalizeAction(value: unknown, document: EaselAssistInput["document"]): EditorAssistAction | null {
  const record = asRecord(value);
  const tool = record.tool;
  if (tool !== "text" && tool !== "rect" && tool !== "brush" && tool !== "eraser") {
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

  if (tool === "rect") {
    const width = clamp(asNumber(record.width, 220), 20, document.width);
    const height = clamp(asNumber(record.height, 120), 8, document.height);
    return {
      tool,
      label: cleanText(record.label, 80) || "Rectangle",
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
    label: cleanText(record.label, 80) || (tool === "eraser" ? "Erase" : "Brush"),
    points,
    stroke: tool === "eraser" ? "#ffffff" : cleanColor(record.stroke, "#ff8a5b"),
    strokeWidth: clamp(asNumber(record.strokeWidth, tool === "eraser" ? 24 : 8), 2, 80),
  };
}

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