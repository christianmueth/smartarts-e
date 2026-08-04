ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "googlePlayProductId" TEXT,
ADD COLUMN IF NOT EXISTS "googlePlayPurchaseToken" TEXT,
ADD COLUMN IF NOT EXISTS "googlePlaySubscriptionStatus" TEXT,
ADD COLUMN IF NOT EXISTS "googlePlaySubscriptionEnd" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "googlePlayAutoRenewing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "googlePlayLastVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_googlePlayPurchaseToken_key" ON "User"("googlePlayPurchaseToken");