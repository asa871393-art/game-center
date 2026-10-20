-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('FIXED', 'OPEN');

-- CreateEnum
CREATE TYPE "PriceTier" AS ENUM ('SINGLE', 'MULTI', 'VIP');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ZAINCASH';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "mode" "SessionMode" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "pausedMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priceTier" "PriceTier" NOT NULL DEFAULT 'SINGLE';

-- AlterTable
ALTER TABLE "DeviceCategory" ADD COLUMN     "multiTierBps" INTEGER,
ADD COLUMN     "vipTierBps" INTEGER;

-- CreateTable
CREATE TABLE "SessionSegment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "priceTier" "PriceTier" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "amount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionSegment_bookingId_startedAt_idx" ON "SessionSegment"("bookingId", "startedAt");

-- CreateIndex
CREATE INDEX "SessionSegment_deviceId_idx" ON "SessionSegment"("deviceId");

-- AddForeignKey
ALTER TABLE "SessionSegment" ADD CONSTRAINT "SessionSegment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSegment" ADD CONSTRAINT "SessionSegment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Hand-written constraints (keep when squashing migrations).
-- =============================================================================

-- A session has at most one running segment.
CREATE UNIQUE INDEX "SessionSegment_one_running_per_booking"
  ON "SessionSegment"("bookingId") WHERE "endedAt" IS NULL;

ALTER TABLE "SessionSegment"
  ADD CONSTRAINT "SessionSegment_time_chk" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt"),
  ADD CONSTRAINT "SessionSegment_money_chk" CHECK (("minutes" IS NULL OR "minutes" >= 0) AND ("amount" IS NULL OR "amount" >= 0));

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_paused_chk" CHECK ("pausedMinutes" >= 0);

ALTER TABLE "DeviceCategory"
  ADD CONSTRAINT "DeviceCategory_tiers_chk" CHECK (
    ("multiTierBps" IS NULL OR "multiTierBps" > 0) AND ("vipTierBps" IS NULL OR "vipTierBps" > 0)
  );

-- Demo defaults for existing data: console couches offer 4-controller and VIP tiers.
UPDATE "DeviceCategory" SET "multiTierBps" = 15000, "vipTierBps" = 20000 WHERE "type" = 'CONSOLE';
UPDATE "DeviceCategory" SET "multiTierBps" = 15000 WHERE "type" = 'VIP_ROOM';
