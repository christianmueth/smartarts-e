import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  createPrismaClient();

if (process.env.NODE_ENV !== "production") global.prisma = prisma;

function createPrismaClient(): PrismaClient {
  try {
    return new PrismaClient({
      log: ["warn", "error"],
    });
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : "@prisma/client is unavailable";

    return new Proxy(
      {},
      {
        get() {
          throw new Error(`Prisma client is unavailable in this environment: ${message}`);
        },
      }
    ) as PrismaClient;
  }
}

export function isMissingUserTableError(error: unknown) {
  const code = typeof (error as { code?: unknown } | null)?.code === "string"
    ? String((error as { code?: string }).code)
    : "";
  const table = String((error as { meta?: { table?: unknown } } | null)?.meta?.table || "");
  const message = String((error as { message?: unknown } | null)?.message || "");

  return (
    code === "P2021" &&
    (
      table.includes("User") ||
      /public\.User/i.test(message) ||
      /table\s+.*User\s+does not exist/i.test(message) ||
      /prisma\.user\.upsert\(\)/i.test(message)
    )
  );
}

export function isMissingTableOrColumnError(error: unknown, names?: string[]) {
  const code = typeof (error as { code?: unknown } | null)?.code === "string"
    ? String((error as { code?: string }).code)
    : "";
  const table = String((error as { meta?: { table?: unknown } } | null)?.meta?.table || "");
  const column = String((error as { meta?: { column?: unknown } } | null)?.meta?.column || "");
  const message = String((error as { message?: unknown } | null)?.message || "");
  const needles = Array.isArray(names) ? names.filter(Boolean) : [];

  const looksMissing =
    code === "P2021" ||
    code === "P2022" ||
    /does not exist/i.test(message) ||
    /Unknown arg/i.test(message) ||
    /Unknown field/i.test(message) ||
    /column .* does not exist/i.test(message);

  if (!looksMissing) return false;
  if (!needles.length) return true;

  return needles.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    return pattern.test(table) || pattern.test(column) || pattern.test(message);
  });
}

export async function safeUpsertUser<T extends Prisma.UserSelect>(clerkUserId: string, select: T) {
  try {
    return await prisma.user.upsert({
      where: { clerkUserId },
      update: {},
      create: { clerkUserId },
      select,
    });
  } catch (error) {
    if (isMissingUserTableError(error)) {
      console.warn("[db] User table unavailable; skipping user persistence");
      return null;
    }
    throw error;
  }
}
