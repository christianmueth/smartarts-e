import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteStudioAssetForClerkUser, setStudioAssetFavoriteForClerkUser } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const body = (await req.json()) as { favorite?: boolean };
    const result = await setStudioAssetFavoriteForClerkUser({
      clerkUserId,
      assetId: id,
      favorite: Boolean(body.favorite),
    });

    return NextResponse.json({ ok: true, assetId: result.assetId, favorite: result.favorite, project: result.project });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Asset update failed." }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const result = await deleteStudioAssetForClerkUser({
      clerkUserId,
      assetId: id,
    });

    return NextResponse.json({ ok: true, assetId: result.assetId, project: result.project });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Asset deletion failed." }, { status: 400 });
  }
}