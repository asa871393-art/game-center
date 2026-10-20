-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
ALTER TYPE "MenuItemCategory" ADD VALUE 'HOOKAH';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'FASTPAY';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "shiftId" TEXT;

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "openingFloat" DECIMAL(12,2) NOT NULL,
    "expectedCash" DECIMAL(12,2),
    "countedCash" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shift_loungeId_openedAt_idx" ON "Shift"("loungeId", "openedAt");

-- CreateIndex
CREATE INDEX "Transaction_shiftId_idx" ON "Transaction"("shiftId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Hand-written (keep when squashing migrations).
-- =============================================================================

-- One cash drawer per lounge: at most one open shift.
CREATE UNIQUE INDEX "Shift_one_open_per_lounge" ON "Shift"("loungeId") WHERE "status" = 'OPEN';

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_money_chk" CHECK ("openingFloat" >= 0 AND ("countedCash" IS NULL OR "countedCash" >= 0)),
  ADD CONSTRAINT "Shift_closed_chk" CHECK (
    ("status" = 'OPEN' AND "closedAt" IS NULL) OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "countedCash" IS NOT NULL)
  );

-- Opening/closing a shift updates every POS screen of the lounge (see the realtime migration).
CREATE TRIGGER "Shift_notify_lounge_event"
  AFTER INSERT OR UPDATE OR DELETE ON "Shift"
  FOR EACH ROW EXECUTE FUNCTION notify_lounge_event();
