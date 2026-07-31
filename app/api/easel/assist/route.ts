import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { planEasyEaselAssist } from "@/lib/easy-easel-assist";
import type { EditorAssistLayerCandidate, EditorAssistSelectedLayer } from "@/types/easy-easel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      prompt?: string;
      document?: {
        width?: number;
        height?: number;
        backgroundColor?: string;
        layerCount?: number;
      };
      layers?: EditorAssistLayerCandidate[];
      selectedLayer?: EditorAssistSelectedLayer | null;
    };

    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "A prompt is required." }, { status: 400 });
    }

    const plan = await planEasyEaselAssist({
      prompt,
      document: {
        width: Number.isFinite(Number(body.document?.width)) ? Number(body.document?.width) : 1400,
        height: Number.isFinite(Number(body.document?.height)) ? Number(body.document?.height) : 900,
        backgroundColor: String(body.document?.backgroundColor || "#ffffff"),
        layerCount: Number.isFinite(Number(body.document?.layerCount)) ? Number(body.document?.layerCount) : 0,
      },
      layers: Array.isArray(body.layers) ? body.layers : [],
      selectedLayer: body.selectedLayer || null,
    });

    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Easel assist failed." }, { status: 400 });
  }
}