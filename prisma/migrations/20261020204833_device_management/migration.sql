-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "hourlyRateOverride" DECIMAL(12,2),
ADD COLUMN     "multiTierBpsOverride" INTEGER,
ADD COLUMN     "vipTierBpsOverride" INTEGER;

-- Hand-written (keep when squashing migrations).
ALTER TABLE "Device"
  ADD CONSTRAINT "Device_pricing_chk" CHECK (
    ("hourlyRateOverride" IS NULL OR "hourlyRateOverride" >= 0)
    AND ("multiTierBpsOverride" IS NULL OR "multiTierBpsOverride" > 0)
    AND ("vipTierBpsOverride" IS NULL OR "vipTierBpsOverride" > 0)
  );

-- Floor-plan and POS queries skip archived devices.
CREATE INDEX "Device_loungeId_active_idx" ON "Device"("loungeId") WHERE "archivedAt" IS NULL;
