import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { editEditorAssetForClerkUser } from "@/lib/easy-easel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { assetId?: string; sourceUrl?: string; sourceTitle?: string; prompt?: string; count?: number };
    const assetId = String(body.assetId || "").trim();
    const sourceUrl = String(body.sourceUrl || "").trim();
    if (!assetId && !sourceUrl) {
      return NextResponse.json({ ok: false, error: "Select an image layer first." }, { status: 400 });
    }

    const assets = await editEditorAssetForClerkUser({
      clerkUserId,
      assetId,
      sourceUrl,
      sourceTitle: body.sourceTitle || "",
      prompt: body.prompt || "",
      count: body.count,
    });

    return NextResponse.json({ ok: true, assets });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Image edit failed." }, { status: 400 });
  }
}
