import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createStudioProjectForClerkUser, listStudioProjectsForClerkUser } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const projects = await listStudioProjectsForClerkUser(clerkUserId);
    return NextResponse.json({ ok: true, projects });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Studio projects are unavailable." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { name?: string; brief?: string; visualDirection?: string };
    const project = await createStudioProjectForClerkUser({
      clerkUserId,
      name: body.name || "",
      brief: body.brief || null,
      visualDirection: body.visualDirection || null,
    });

    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Project creation failed." }, { status: 400 });
  }
}