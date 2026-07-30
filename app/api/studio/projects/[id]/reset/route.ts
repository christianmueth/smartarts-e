import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resetStudioProjectForClerkUser } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const result = await resetStudioProjectForClerkUser({
      clerkUserId,
      projectId: id,
    });

    return NextResponse.json({ ok: true, project: result.project, deletedAssetCount: result.deletedAssetCount });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Project reset failed." }, { status: 400 });
  }
}