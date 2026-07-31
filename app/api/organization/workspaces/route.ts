import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  createOrganizationWorkspaceForClerkUser,
  listOrganizationWorkspacesForClerkUser,
} from "@/lib/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const workspaces = await listOrganizationWorkspacesForClerkUser(clerkUserId);
    return NextResponse.json({ ok: true, workspaces });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Premium Suite workspaces.";
    const status = /Premium is required/i.test(message) ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as {
      name?: string;
      description?: string | null;
      brandGuide?: string | null;
      approvalMode?: string | null;
    };

    const workspaces = await createOrganizationWorkspaceForClerkUser({
      clerkUserId,
      name: body.name || "",
      description: body.description,
      brandGuide: body.brandGuide,
      approvalMode: body.approvalMode,
    });

    return NextResponse.json({ ok: true, workspaces });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create Premium Suite workspace.";
    const status = /Premium is required/i.test(message) ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}