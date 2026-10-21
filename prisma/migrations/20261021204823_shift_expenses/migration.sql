-- CreateTable
CREATE TABLE "ShiftExpense" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,

    CONSTRAINT "ShiftExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftExpense_shiftId_idx" ON "ShiftExpense"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftExpense_loungeId_createdAt_idx" ON "ShiftExpense"("loungeId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShiftExpense" ADD CONSTRAINT "ShiftExpense_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftExpense" ADD CONSTRAINT "ShiftExpense_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftExpense" ADD CONSTRAINT "ShiftExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftExpense" ADD CONSTRAINT "ShiftExpense_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Amounts are positive; a void records who and when together.
ALTER TABLE "ShiftExpense" ADD CONSTRAINT "ShiftExpense_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ShiftExpense" ADD CONSTRAINT "ShiftExpense_void_complete" CHECK (("voidedAt" IS NULL) = ("voidedById" IS NULL));

-- Live POS screens refresh the drawer total when an expense is added or voided.
CREATE TRIGGER "ShiftExpense_notify_lounge_event"
  AFTER INSERT OR UPDATE OR DELETE ON "ShiftExpense"
  FOR EACH ROW EXECUTE FUNCTION notify_lounge_event();