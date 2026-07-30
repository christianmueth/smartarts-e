import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listEditorAssetsForClerkUser } from "@/lib/easy-easel";

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
