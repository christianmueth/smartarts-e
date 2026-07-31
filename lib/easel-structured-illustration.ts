import type { EditorAssistAction, EditorAssistPlan } from "@/types/easy-easel";

type IllustrationDocument = {
  width: number;
  height: number;
};

type IllustrationKind = "person" | "animal" | "vehicle" | "plant" | "place" | "food" | "object";

export function buildStructuredIllustrationPlan(prompt: string, document: IllustrationDocument): EditorAssistPlan {
  const subject = extractSubject(prompt);
  const kind = classifyIllustration(subject);
  const palette = selectPalette(prompt);
  const centerX = document.width * 0.5;
  const centerY = document.height * 0.43;
  const scale = Math.min(document.width, document.height) / 900;
  const actions = buildIllustrationActions(kind, subject, centerX, centerY, scale, palette);

  return {
    mode: "canvas",
    assistantMessage: `Building a structured ${kind} illustration for ${subject}.`,
    actions,
  };
}

function buildIllustrationActions(kind: IllustrationKind, subject: string, centerX: number, centerY: number, scale: number, palette: string[]) {
  const [primary, accent, dark, light, ground] = palette;
  const unit = (value: number) => value * scale;
  const commonGround: EditorAssistAction = {
    tool: "brush",
    label: `${subject} ground`,
    points: [centerX - unit(180), centerY + unit(210), centerX, centerY + unit(224), centerX + unit(180), centerY + unit(210)],
    stroke: ground,
    strokeWidth: Math.max(4, unit(6)),
  };

  if (kind === "person") {
    return [
      { tool: "ellipse", label: `${subject} head`, x: centerX - unit(48), y: centerY - unit(172), width: unit(96), height: unit(96), stroke: dark, fill: withAlpha(light, 0.6), strokeWidth: Math.max(4, unit(5)) },
      { tool: "brush", label: `${subject} body`, points: [centerX - unit(74), centerY + unit(126), centerX - unit(60), centerY - unit(58), centerX, centerY - unit(84), centerX + unit(60), centerY - unit(58), centerX + unit(74), centerY + unit(126), centerX - unit(74), centerY + unit(126)], stroke: primary, strokeWidth: Math.max(6, unit(9)) },
      { tool: "brush", label: `${subject} arms`, points: [centerX - unit(56), centerY - unit(28), centerX - unit(150), centerY + unit(44), centerX - unit(120), centerY + unit(72), centerX - unit(56), centerY + unit(22), centerX + unit(56), centerY + unit(22), centerX + unit(120), centerY + unit(72), centerX + unit(150), centerY + unit(44)], stroke: accent, strokeWidth: Math.max(5, unit(7)) },
      { tool: "brush", label: `${subject} legs`, points: [centerX - unit(34), centerY + unit(126), centerX - unit(72), centerY + unit(202), centerX - unit(108), centerY + unit(202), centerX + unit(34), centerY + unit(126), centerX + unit(72), centerY + unit(202), centerX + unit(108), centerY + unit(202)], stroke: dark, strokeWidth: Math.max(5, unit(7)) },
      { tool: "brush", label: `${subject} face`, points: [centerX - unit(22), centerY - unit(132), centerX - unit(12), centerY - unit(126), centerX - unit(2), centerY - unit(132), centerX + unit(18), centerY - unit(132), centerX + unit(28), centerY - unit(126), centerX + unit(38), centerY - unit(132)], stroke: dark, strokeWidth: Math.max(3, unit(4)) },
      commonGround,
    ];
  }

  if (kind === "animal") {
    return [
      { tool: "ellipse", label: `${subject} body`, x: centerX - unit(138), y: centerY - unit(8), width: unit(240), height: unit(142), stroke: primary, fill: withAlpha(primary, 0.18), strokeWidth: Math.max(5, unit(7)) },
      { tool: "ellipse", label: `${subject} head`, x: centerX + unit(68), y: centerY - unit(76), width: unit(104), height: unit(104), stroke: primary, fill: withAlpha(light, 0.54), strokeWidth: Math.max(5, unit(7)) },
      { tool: "brush", label: `${subject} ears`, points: [centerX + unit(82), centerY - unit(64), centerX + unit(84), centerY - unit(124), centerX + unit(116), centerY - unit(76), centerX + unit(140), centerY - unit(76), centerX + unit(152), centerY - unit(128), centerX + unit(166), centerY - unit(60)], stroke: accent, strokeWidth: Math.max(4, unit(6)) },
      { tool: "brush", label: `${subject} legs`, points: [centerX - unit(84), centerY + unit(112), centerX - unit(92), centerY + unit(198), centerX - unit(52), centerY + unit(198), centerX + unit(44), centerY + unit(116), centerX + unit(54), centerY + unit(198), centerX + unit(94), centerY + unit(198)], stroke: dark, strokeWidth: Math.max(5, unit(7)) },
      { tool: "brush", label: `${subject} tail`, points: [centerX - unit(130), centerY + unit(34), centerX - unit(188), centerY - unit(10), centerX - unit(204), centerY + unit(38), centerX - unit(170), centerY + unit(74)], stroke: accent, strokeWidth: Math.max(4, unit(6)) },
      { tool: "ellipse", label: `${subject} eye`, x: centerX + unit(124), y: centerY - unit(42), width: unit(13), height: unit(13), stroke: dark, fill: dark, strokeWidth: 2 },
      commonGround,
    ];
  }

  if (kind === "vehicle") {
    return [
      { tool: "brush", label: `${subject} body`, points: [centerX - unit(162), centerY + unit(84), centerX - unit(142), centerY + unit(8), centerX - unit(44), centerY - unit(58), centerX + unit(88), centerY - unit(48), centerX + unit(166), centerY + unit(26), centerX + unit(152), centerY + unit(94), centerX - unit(162), centerY + unit(84)], stroke: primary, strokeWidth: Math.max(6, unit(9)) },
      { tool: "brush", label: `${subject} window or cabin`, points: [centerX - unit(36), centerY - unit(48), centerX + unit(12), centerY - unit(98), centerX + unit(78), centerY - unit(42)], stroke: light, strokeWidth: Math.max(5, unit(7)) },
      { tool: "ellipse", label: `${subject} left wheel`, x: centerX - unit(112), y: centerY + unit(54), width: unit(66), height: unit(66), stroke: dark, fill: withAlpha(dark, 0.28), strokeWidth: Math.max(5, unit(7)) },
      { tool: "ellipse", label: `${subject} right wheel`, x: centerX + unit(76), y: centerY + unit(54), width: unit(66), height: unit(66), stroke: dark, fill: withAlpha(dark, 0.28), strokeWidth: Math.max(5, unit(7)) },
      { tool: "brush", label: `${subject} accent`, points: [centerX - unit(130), centerY + unit(24), centerX - unit(18), centerY + unit(16), centerX + unit(126), centerY + unit(34)], stroke: accent, strokeWidth: Math.max(4, unit(6)) },
      commonGround,
    ];
  }

  if (kind === "plant") {
    return [
      { tool: "brush", label: `${subject} stem`, points: [centerX, centerY + unit(194), centerX - unit(8), centerY + unit(78), centerX + unit(6), centerY - unit(44)], stroke: dark, strokeWidth: Math.max(6, unit(9)) },
      { tool: "ellipse", label: `${subject} bloom or crown`, x: centerX - unit(90), y: centerY - unit(136), width: unit(180), height: unit(148), stroke: primary, fill: withAlpha(primary, 0.22), strokeWidth: Math.max(5, unit(7)) },
      { tool: "ellipse", label: `${subject} center`, x: centerX - unit(28), y: centerY - unit(78), width: unit(56), height: unit(56), stroke: accent, fill: withAlpha(accent, 0.35), strokeWidth: Math.max(4, unit(5)) },
      { tool: "brush", label: `${subject} leaves`, points: [centerX - unit(4), centerY + unit(88), centerX - unit(96), centerY + unit(48), centerX - unit(122), centerY + unit(90), centerX - unit(4), centerY + unit(124), centerX + unit(86), centerY + unit(70), centerX + unit(114), centerY + unit(112)], stroke: primary, strokeWidth: Math.max(5, unit(7)) },
      commonGround,
    ];
  }

  if (kind === "place") {
    return [
      { tool: "rect", label: `${subject} main structure`, x: centerX - unit(128), y: centerY - unit(18), width: unit(256), height: unit(190), stroke: primary, fill: withAlpha(primary, 0.16), strokeWidth: Math.max(5, unit(7)) },
      { tool: "brush", label: `${subject} roof or skyline`, points: [centerX - unit(152), centerY - unit(12), centerX - unit(54), centerY - unit(128), centerX + unit(30), centerY - unit(70), centerX + unit(104), centerY - unit(146), centerX + unit(154), centerY - unit(12)], stroke: dark, strokeWidth: Math.max(6, unit(8)) },
      { tool: "rect", label: `${subject} entrance`, x: centerX - unit(32), y: centerY + unit(76), width: unit(64), height: unit(96), stroke: dark, fill: withAlpha(dark, 0.14), strokeWidth: Math.max(4, unit(5)) },
      { tool: "ellipse", label: `${subject} window left`, x: centerX - unit(94), y: centerY + unit(30), width: unit(38), height: unit(38), stroke: accent, fill: withAlpha(light, 0.5), strokeWidth: Math.max(3, unit(4)) },
      { tool: "ellipse", label: `${subject} window right`, x: centerX + unit(56), y: centerY + unit(30), width: unit(38), height: unit(38), stroke: accent, fill: withAlpha(light, 0.5), strokeWidth: Math.max(3, unit(4)) },
      commonGround,
    ];
  }

  if (kind === "food") {
    return [
      { tool: "ellipse", label: `${subject} main form`, x: centerX - unit(118), y: centerY - unit(88), width: unit(236), height: unit(178), stroke: primary, fill: withAlpha(primary, 0.22), strokeWidth: Math.max(6, unit(8)) },
      { tool: "brush", label: `${subject} top detail`, points: [centerX - unit(52), centerY - unit(82), centerX, centerY - unit(142), centerX + unit(56), centerY - unit(80)], stroke: accent, strokeWidth: Math.max(5, unit(7)) },
      { tool: "brush", label: `${subject} surface detail`, points: [centerX - unit(74), centerY - unit(8), centerX - unit(20), centerY + unit(18), centerX + unit(28), centerY - unit(4), centerX + unit(78), centerY + unit(22)], stroke: light, strokeWidth: Math.max(4, unit(5)) },
      { tool: "brush", label: `${subject} base`, points: [centerX - unit(96), centerY + unit(88), centerX, centerY + unit(114), centerX + unit(96), centerY + unit(88)], stroke: dark, strokeWidth: Math.max(4, unit(6)) },
      commonGround,
    ];
  }

  return [
    { tool: "rect", label: `${subject} main body`, x: centerX - unit(112), y: centerY - unit(96), width: unit(224), height: unit(190), stroke: primary, fill: withAlpha(primary, 0.16), strokeWidth: Math.max(6, unit(8)) },
    { tool: "ellipse", label: `${subject} top feature`, x: centerX - unit(52), y: centerY - unit(146), width: unit(104), height: unit(76), stroke: accent, fill: withAlpha(light, 0.48), strokeWidth: Math.max(4, unit(6)) },
    { tool: "brush", label: `${subject} left component`, points: [centerX - unit(112), centerY - unit(28), centerX - unit(170), centerY - unit(4), centerX - unit(170), centerY + unit(50), centerX - unit(112), centerY + unit(60)], stroke: dark, strokeWidth: Math.max(5, unit(7)) },
    { tool: "brush", label: `${subject} right component`, points: [centerX + unit(112), centerY - unit(28), centerX + unit(170), centerY - unit(4), centerX + unit(170), centerY + unit(50), centerX + unit(112), centerY + unit(60)], stroke: dark, strokeWidth: Math.max(5, unit(7)) },
    { tool: "brush", label: `${subject} front detail`, points: [centerX - unit(66), centerY + unit(12), centerX - unit(18), centerY + unit(36), centerX + unit(28), centerY + unit(14), centerX + unit(72), centerY + unit(42)], stroke: accent, strokeWidth: Math.max(4, unit(6)) },
    { tool: "brush", label: `${subject} base`, points: [centerX - unit(90), centerY + unit(96), centerX, centerY + unit(122), centerX + unit(90), centerY + unit(96)], stroke: dark, strokeWidth: Math.max(4, unit(6)) },
    commonGround,
  ];
}

function classifyIllustration(subject: string): IllustrationKind {
  const text = subject.toLowerCase();
  if (/\b(?:person|man|woman|child|girl|boy|human|student|teacher|doctor|artist|runner|dancer|robot)\b/.test(text)) return "person";
  if (/\b(?:animal|dog|cat|horse|cow|bird|fish|lion|tiger|bear|elephant|rabbit|fox|wolf|dragon|butterfly|insect)\b/.test(text)) return "animal";
  if (/\b(?:car|vehicle|truck|bus|train|plane|airplane|boat|ship|rocket|bicycle|bike|scooter)\b/.test(text)) return "vehicle";
  if (/\b(?:tree|flower|plant|leaf|forest|bush|cactus|garden)\b/.test(text)) return "plant";
  if (/\b(?:house|home|building|tower|castle|barn|bridge|city|village|school|church|room|landscape|mountain)\b/.test(text)) return "place";
  if (/\b(?:food|fruit|apple|pizza|cake|bread|burger|sandwich|drink|coffee|cup|bottle)\b/.test(text)) return "food";
  return "object";
}

function selectPalette(prompt: string) {
  const palettes = [
    ["#e84a5f", "#ffb200", "#7a1f4f", "#ffe09c", "#5f7a3c"],
    ["#4d8cff", "#5abf9a", "#174a8b", "#d8efff", "#4f7258"],
    ["#2ca24f", "#ff8a5b", "#1d6b3d", "#f4d29d", "#64794a"],
  ];
  return palettes[hashText(prompt) % palettes.length];
}

function extractSubject(prompt: string) {
  const cleaned = prompt.replace(/^(?:please\s+)?(?:draw|doodle|sketch|paint|make|create|generate|illustrate|add|show)\s+(?:me\s+)?/i, "").replace(/^(?:a|an|the)\s+/i, "").replace(/[.!?]+$/g, "").trim();
  return (cleaned || "object").slice(0, 64);
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}

function withAlpha(color: string, alpha: number) {
  const hex = color.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}