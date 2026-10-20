-- CreateEnum
CREATE TYPE "CheckoutMethod" AS ENUM ('PAY_AT_LOUNGE', 'ZAINCASH', 'FASTPAY');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "checkoutMethod" "CheckoutMethod" NOT NULL DEFAULT 'PAY_AT_LOUNGE',
ADD COLUMN     "expiresAt" TIMESTAMP(3);
