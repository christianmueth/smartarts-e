import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { put } from "@vercel/blob";
import { createUploadedEditorAssetForClerkUser } from "@/lib/easy-easel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const shouldSave = String(formData.get("saved") || "").trim().toLowerCase() === "true";
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No image provided." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Only image uploads are supported." }, { status: 400 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const pathname = `uploads/easy-easel/${Date.now()}-${safeName}`;
    const blob = await put(pathname, file, {
      access: "public",
      contentType: file.type || "image/png",
      addRandomSuffix: true,
    });

    const asset = await createUploadedEditorAssetForClerkUser({
      clerkUserId,
      title: file.name.replace(/\.[^.]+$/, "") || "Uploaded image",
      imageUrl: blob.url,
      mimeType: file.type || null,
      saved: shouldSave,
    });

    return NextResponse.json({ ok: true, asset });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Image upload failed." }, { status: 500 });
  }
}
