import { getBillingSnapshotForClerkUser } from "@/lib/billing";
import { prisma, safeUpsertUser } from "@/lib/db";

export const FREE_IMAGE_GENERATION_LIMIT = 10;

type GenerationReservation = {
  clerkUserId: string;
  reservedCount: number;
  isPremium: boolean;
};

export async function getImageGenerationAccessForClerkUser(clerkUserId: string) {
  const [billing, user] = await Promise.all([
    getBillingSnapshotForClerkUser(clerkUserId),
    safeUpsertUser(clerkUserId, { imageGenerationCount: true }),
  ]);
  const used = user?.imageGenerationCount || 0;

  return {
    isPremium: billing.isPremium,
    used,
    remaining: billing.isPremium ? null : Math.max(0, FREE_IMAGE_GENERATION_LIMIT - used),
    canGenerate: billing.isPremium || used < FREE_IMAGE_GENERATION_LIMIT,
  };
}

export async function reserveImageGenerations(clerkUserId: string, requestedCount: number): Promise<GenerationReservation> {
  const count = Math.max(1, Math.floor(requestedCount));
  const billing = await getBillingSnapshotForClerkUser(clerkUserId);
  if (billing.isPremium) {
    return { clerkUserId, reservedCount: 0, isPremium: true };
  }

  const user = await safeUpsertUser(clerkUserId, { id: true });
  if (!user) {
    throw new Error("User persistence is unavailable right now.");
  }

  const updated = await prisma.user.updateMany({
    where: {
      id: user.id,
      imageGenerationCount: { lte: FREE_IMAGE_GENERATION_LIMIT - count },
    },
    data: { imageGenerationCount: { increment: count } },
  });
  if (updated.count !== 1) {
    throw new Error(`Your ${FREE_IMAGE_GENERATION_LIMIT} free image generations are used. Upgrade to Premium to continue with Easy Easel.`);
  }

  return { clerkUserId, reservedCount: count, isPremium: false };
}

export async function settleImageGenerationReservation(reservation: GenerationReservation, producedCount: number) {
  if (reservation.isPremium || reservation.reservedCount === 0) return;
  const unusedCount = Math.max(0, reservation.reservedCount - Math.max(0, Math.floor(producedCount)));
  if (!unusedCount) return;

  const user = await safeUpsertUser(reservation.clerkUserId, { id: true });
  if (!user) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { imageGenerationCount: { decrement: unusedCount } },
    select: { id: true },
  });
}