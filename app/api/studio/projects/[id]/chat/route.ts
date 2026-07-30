import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runStudioProjectCommand } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const body = (await req.json()) as { content?: string; assetId?: string };
    const result = await runStudioProjectCommand({
      clerkUserId,
      projectId: id,
      content: body.content || "",
      assetId: body.assetId || null,
    });

    return NextResponse.json({ ok: true, project: result.project, createdAssetId: result.createdAssetId });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Studio command failed." }, { status: 400 });
  }
}