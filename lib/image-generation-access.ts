import { getBillingSnapshotForClerkUser } from "@/lib/billing";
import { isMissingTableOrColumnError, prisma, safeUpsertUser } from "@/lib/db";

export const FREE_IMAGE_GENERATION_LIMIT = 10;

type GenerationReservation = {
  clerkUserId: string;
  reservedCount: number;
  isPremium: boolean;
  periodStartedAt: Date | null;
};

export async function getImageGenerationAccessForClerkUser(clerkUserId: string) {
  const billing = await getBillingSnapshotForClerkUser(clerkUserId);
  try {
    const user = await safeUpsertUser(clerkUserId, { id: true, imageGenerationCount: true, imageGenerationPeriodStartedAt: true });
    const monthStartedAt = startOfCurrentMonth();
    if (user && user.imageGenerationPeriodStartedAt < monthStartedAt) {
      await prisma.user.updateMany({
        where: { id: user.id, imageGenerationPeriodStartedAt: { lt: monthStartedAt } },
        data: { imageGenerationCount: 0, imageGenerationPeriodStartedAt: monthStartedAt },
      });
    }
    const currentUser = user
      ? await prisma.user.findUnique({ where: { id: user.id }, select: { imageGenerationCount: true } })
      : null;
    const used = currentUser?.imageGenerationCount || 0;

    return buildGenerationAccess(billing.isPremium, used);
  } catch (error) {
    if (!isQuotaSchemaUnavailable(error)) throw error;
    console.warn("[image-generation] Quota columns are unavailable; deploy the pending Prisma migrations.");
    return buildGenerationAccess(billing.isPremium, 0);
  }
}

export async function reserveImageGenerations(clerkUserId: string, requestedCount: number): Promise<GenerationReservation> {
  const count = Math.max(1, Math.floor(requestedCount));
  const monthStartedAt = startOfCurrentMonth();
  const billing = await getBillingSnapshotForClerkUser(clerkUserId);
  if (billing.isPremium) {
    return { clerkUserId, reservedCount: 0, isPremium: true, periodStartedAt: null };
  }

  try {
    const user = await safeUpsertUser(clerkUserId, { id: true });
    if (!user) {
      throw new Error("User persistence is unavailable right now.");
    }

    const resetAndReserve = await prisma.user.updateMany({
      where: {
        id: user.id,
        imageGenerationPeriodStartedAt: { lt: monthStartedAt },
      },
      data: { imageGenerationCount: count, imageGenerationPeriodStartedAt: monthStartedAt },
    });
    if (resetAndReserve.count === 1) {
      return { clerkUserId, reservedCount: count, isPremium: false, periodStartedAt: monthStartedAt };
    }

    const updated = await prisma.user.updateMany({
      where: {
        id: user.id,
        imageGenerationPeriodStartedAt: { gte: monthStartedAt },
        imageGenerationCount: { lte: FREE_IMAGE_GENERATION_LIMIT - count },
      },
      data: { imageGenerationCount: { increment: count } },
    });
    if (updated.count !== 1) {
      throw new Error(`Your ${FREE_IMAGE_GENERATION_LIMIT} free image generations for this month are used. Upgrade to Premium to continue with Easy Easel.`);
    }

    return { clerkUserId, reservedCount: count, isPremium: false, periodStartedAt: monthStartedAt };
  } catch (error) {
    if (isQuotaSchemaUnavailable(error)) {
      throw new Error("Image generation quota is being initialized. Please try again after the database migration is deployed.");
    }
    throw error;
  }
}

export async function settleImageGenerationReservation(reservation: GenerationReservation, producedCount: number) {
  if (reservation.isPremium || reservation.reservedCount === 0) return;
  const unusedCount = Math.max(0, reservation.reservedCount - Math.max(0, Math.floor(producedCount)));
  if (!unusedCount) return;

  const user = await safeUpsertUser(reservation.clerkUserId, { id: true });
  if (!user) return;
  await prisma.user.updateMany({
    where: { id: user.id, imageGenerationPeriodStartedAt: reservation.periodStartedAt || undefined },
    data: { imageGenerationCount: { decrement: unusedCount } },
  });
}

function startOfCurrentMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function buildGenerationAccess(isPremium: boolean, used: number) {
  return {
    isPremium,
    used,
    remaining: isPremium ? null : Math.max(0, FREE_IMAGE_GENERATION_LIMIT - used),
    canGenerate: isPremium || used < FREE_IMAGE_GENERATION_LIMIT,
  };
}

function isQuotaSchemaUnavailable(error: unknown) {
  return isMissingTableOrColumnError(error, ["imageGenerationCount", "imageGenerationPeriodStartedAt"]);
}