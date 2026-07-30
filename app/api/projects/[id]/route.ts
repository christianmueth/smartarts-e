import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getEditorProjectForClerkUser, saveEditorProjectForClerkUser } from "@/lib/easy-easel";
import type { EditorCanvasDocument } from "@/types/easy-easel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const project = await getEditorProjectForClerkUser(clerkUserId, id);
    if (!project) {
      return NextResponse.json({ ok: false, error: "Project not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Project loading failed." }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const body = (await req.json()) as { name?: string; canvas?: EditorCanvasDocument; previewUrl?: string | null };
    const project = await saveEditorProjectForClerkUser({
      clerkUserId,
      projectId: id,
      name: body.name || null,
      canvas: body.canvas as EditorCanvasDocument,
      previewUrl: body.previewUrl || null,
    });

    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Project save failed." }, { status: 400 });
  }
}
