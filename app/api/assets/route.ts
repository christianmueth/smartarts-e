import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listEditorAssetsForClerkUser, saveEditorSnapshotAssetForClerkUser } from "@/lib/easy-easel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const assets = await listEditorAssetsForClerkUser(clerkUserId);
    return NextResponse.json({ ok: true, assets });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Assets are unavailable." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      title?: string;
      imageDataUrl?: string;
      mimeType?: string;
      width?: number;
      height?: number;
    };

    const imageDataUrl = String(body.imageDataUrl || "").trim();
    if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageDataUrl)) {
      return NextResponse.json({ ok: false, error: "A rendered image is required." }, { status: 400 });
    }

    const asset = await saveEditorSnapshotAssetForClerkUser({
      clerkUserId,
      title: String(body.title || "Easy Easel canvas").trim() || "Easy Easel canvas",
      imageUrl: imageDataUrl,
      mimeType: body.mimeType || "image/png",
      width: Number.isFinite(Number(body.width)) ? Number(body.width) : null,
      height: Number.isFinite(Number(body.height)) ? Number(body.height) : null,
    });

    return NextResponse.json({ ok: true, asset });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Library save failed." }, { status: 400 });
  }
}
