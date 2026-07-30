import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateEditorAssetsForClerkUser } from "@/lib/easy-easel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { prompt?: string; count?: number };
    const assets = await generateEditorAssetsForClerkUser({
      clerkUserId,
      prompt: body.prompt || "",
      count: body.count,
    });

    return NextResponse.json({ ok: true, assets });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Image generation failed." }, { status: 400 });
  }
}
