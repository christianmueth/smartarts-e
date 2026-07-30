import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createEditorProjectForClerkUser, listEditorProjectsForClerkUser } from "@/lib/easy-easel";
import type { EditorCanvasDocument } from "@/types/easy-easel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const projects = await listEditorProjectsForClerkUser(clerkUserId);
    return NextResponse.json({ ok: true, projects });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Projects are unavailable." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { name?: string; canvas?: EditorCanvasDocument | null; previewUrl?: string | null };
    const project = await createEditorProjectForClerkUser({
      clerkUserId,
      name: body.name || "Untitled project",
      canvas: body.canvas || null,
      previewUrl: body.previewUrl || null,
    });

    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Project creation failed." }, { status: 400 });
  }
}
