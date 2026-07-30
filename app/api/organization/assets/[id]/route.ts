import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { shareStudioAssetToOrganizationWorkspaceForClerkUser } from "@/lib/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as { shared?: boolean; workspaceId?: string | null };
    const { id } = await ctx.params;
    const result = await shareStudioAssetToOrganizationWorkspaceForClerkUser({
      clerkUserId,
      assetId: id,
      shared: Boolean(body.shared),
      workspaceId: body.workspaceId ?? null,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update organization sharing.";
    const status = /Organization billing is required/i.test(message) ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}