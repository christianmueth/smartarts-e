import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getStudioProjectDetailForClerkUser, updateStudioProjectForClerkUser } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const query = new URL(req.url).searchParams.get("q");
    const project = await getStudioProjectDetailForClerkUser(clerkUserId, id, query);
    if (!project) {
      return NextResponse.json({ ok: false, error: "Project not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Project loading failed." }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const body = (await req.json()) as { name?: string; brief?: string; visualDirection?: string };
    const project = await updateStudioProjectForClerkUser({
      clerkUserId,
      projectId: id,
      name: body.name,
      brief: body.brief,
      visualDirection: body.visualDirection,
    });

    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Project update failed." }, { status: 400 });
  }
}