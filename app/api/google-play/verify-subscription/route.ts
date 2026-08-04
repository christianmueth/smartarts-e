import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

const verifySubscriptionSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  purchaseToken: z.string().trim().min(1).max(4096),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = verifySubscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid subscription verification request." }, { status: 400 });
  }

  const credentialsConfigured = Boolean(
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim() ||
    (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL?.trim() && process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY?.trim())
  );
  if (!credentialsConfigured) {
    return NextResponse.json({ ok: false, error: "Google Play verification is not configured yet." }, { status: 501 });
  }

  // The purchase token is intentionally never persisted or trusted until the Google Play Developer API verifies it.
  return NextResponse.json({ ok: false, error: "Google Play Developer API verification is not implemented yet." }, { status: 501 });
}