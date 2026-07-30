import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getBillingSnapshotForClerkUser } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type WhiteboardImageRequest = {
  prompt?: string;
  workspaceGoal?: string;
  boardSummary?: string;
  annotations?: string[];
};

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const billing = await getBillingSnapshotForClerkUser(clerkUserId);
    if (!billing.isPremium) {
      return NextResponse.json(
        { ok: false, error: "Premium billing is required for whiteboard image generation. Open Billing to upgrade." },
        { status: 402 }
      );
    }

    const body = (await req.json()) as WhiteboardImageRequest;
    const prompt = clean(body.prompt);
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "An image prompt is required." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY is not configured for image generation." }, { status: 500 });
    }

    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        size: "1024x1024",
        prompt: buildImagePrompt({
          prompt,
          workspaceGoal: clean(body.workspaceGoal),
          boardSummary: clean(body.boardSummary),
          annotations: Array.isArray(body.annotations) ? body.annotations.map(clean).filter(Boolean) : [],
        }),
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const apiMessage = String((data as { error?: { message?: unknown } } | null)?.error?.message || "").trim();
      throw new Error(apiMessage || "Image generation request failed.");
    }

    const image = Array.isArray((data as { data?: Array<{ b64_json?: string; url?: string }> } | null)?.data)
      ? (data as { data: Array<{ b64_json?: string; url?: string }> }).data[0]
      : null;

    if (image?.b64_json) {
      return NextResponse.json({ ok: true, imageUrl: `data:image/png;base64,${image.b64_json}` });
    }

    if (image?.url) {
      return NextResponse.json({ ok: true, imageUrl: image.url });
    }

    throw new Error("Image generation returned no image payload.");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Image generation is unavailable right now." },
      { status: 500 }
    );
  }
}

function buildImagePrompt(input: { prompt: string; workspaceGoal: string; boardSummary: string; annotations: string[] }) {
  return [
    "Create a polished visual reference for an AI-assisted art production whiteboard.",
    "Favor strong composition, clear lighting, believable materials, and production-ready moodboard quality.",
    "Do not add any text, labels, captions, logos, or watermarks unless the request explicitly asks for them.",
    `Primary creative request: ${input.prompt}`,
    `Workspace goal: ${input.workspaceGoal || "none provided"}`,
    `Current board summary: ${input.boardSummary || "empty board"}`,
    `Supporting notes: ${input.annotations.join(" | ") || "none"}`,
  ].join("\n");
}

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}