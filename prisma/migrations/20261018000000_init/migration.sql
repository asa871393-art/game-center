-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'LOUNGE_ADMIN', 'STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "LoungeMemberRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoungeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('PC', 'CONSOLE', 'VR', 'VIP_ROOM', 'SIMULATOR', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('IDLE', 'IN_USE', 'RESERVED', 'MAINTENANCE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('ONLINE', 'WALK_IN', 'PHONE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "MenuItemCategory" AS ENUM ('DRINK', 'SNACK', 'MEAL', 'DESSERT', 'OTHER');

-- CreateEnum
CREATE TYPE "CanteenOrderStatus" AS ENUM ('PENDING', 'PREPARING', 'SERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('PAYMENT', 'REFUND', 'WALLET_TOPUP', 'COMMISSION', 'PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'WALLET', 'ONLINE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "phone" TEXT,
    "image" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT NOT NULL,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "priceMonthly" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "maxLounges" INTEGER NOT NULL DEFAULT 1,
    "maxDevices" INTEGER NOT NULL DEFAULT 20,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lounge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "LoungeStatus" NOT NULL DEFAULT 'DRAFT',
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "country" CHAR(2) NOT NULL,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "coverImageUrl" TEXT,
    "floorPlanWidth" INTEGER NOT NULL DEFAULT 24,
    "floorPlanHeight" INTEGER NOT NULL DEFAULT 16,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lounge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoungePhoto" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoungePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningHours" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "dayOfWeek" SMALLINT NOT NULL,
    "opensAtMinute" SMALLINT NOT NULL,
    "closesAtMinute" SMALLINT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OpeningHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoungeMember" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "LoungeMemberRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoungeMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorZone" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FloorZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCategory" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeviceType" NOT NULL,
    "description" TEXT,
    "baseHourlyRate" DECIMAL(12,2) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "minBookingMinutes" INTEGER NOT NULL DEFAULT 60,
    "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "specs" JSONB,
    "iconName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "zoneId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'IDLE',
    "ipAddress" INET,
    "macAddress" VARCHAR(17),
    "specs" JSONB,
    "notes" TEXT,
    "posX" INTEGER NOT NULL DEFAULT 0,
    "posY" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 1,
    "height" INTEGER NOT NULL DEFAULT 1,
    "rotation" SMALLINT NOT NULL DEFAULT 0,
    "isBookableOnline" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "daysOfWeek" SMALLINT[],
    "startMinute" SMALLINT NOT NULL,
    "endMinute" SMALLINT NOT NULL,
    "hourlyRate" DECIMAL(12,2),
    "multiplierBps" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "customerId" TEXT,
    "createdById" TEXT,
    "source" "BookingSource" NOT NULL DEFAULT 'ONLINE',
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "guestName" TEXT,
    "guestPhone" TEXT,
    "players" INTEGER NOT NULL DEFAULT 1,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "currency" CHAR(3) NOT NULL,
    "hourlyRate" DECIMAL(12,2) NOT NULL,
    "playSubtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "canteenSubtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingExtension" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "previousEnd" TIMESTAMP(3) NOT NULL,
    "newEnd" TIMESTAMP(3) NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "MenuItemCategory" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "imageUrl" TEXT,
    "sku" TEXT,
    "stockQuantity" INTEGER,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenOrder" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "bookingId" TEXT,
    "customerId" TEXT,
    "createdById" TEXT,
    "status" "CanteenOrderStatus" NOT NULL DEFAULT 'PENDING',
    "isPreOrder" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "servedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanteenOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CanteenOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT,
    "bookingId" TEXT,
    "canteenOrderId" TEXT,
    "payoutId" TEXT,
    "userId" TEXT,
    "processedById" TEXT,
    "type" "TransactionType" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "provider" TEXT,
    "providerRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "loungeId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_ownerId_idx" ON "Organization"("ownerId");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_status_idx" ON "Subscription"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Lounge_slug_key" ON "Lounge"("slug");

-- CreateIndex
CREATE INDEX "Lounge_organizationId_idx" ON "Lounge"("organizationId");

-- CreateIndex
CREATE INDEX "Lounge_city_status_idx" ON "Lounge"("city", "status");

-- CreateIndex
CREATE INDEX "Lounge_latitude_longitude_idx" ON "Lounge"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "LoungePhoto_loungeId_sortOrder_idx" ON "LoungePhoto"("loungeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningHours_loungeId_dayOfWeek_key" ON "OpeningHours"("loungeId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "LoungeMember_userId_idx" ON "LoungeMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LoungeMember_loungeId_userId_key" ON "LoungeMember"("loungeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "FloorZone_loungeId_name_key" ON "FloorZone"("loungeId", "name");

-- CreateIndex
CREATE INDEX "DeviceCategory_loungeId_type_idx" ON "DeviceCategory"("loungeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCategory_loungeId_name_key" ON "DeviceCategory"("loungeId", "name");

-- CreateIndex
CREATE INDEX "Device_loungeId_status_idx" ON "Device"("loungeId", "status");

-- CreateIndex
CREATE INDEX "Device_categoryId_idx" ON "Device"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_loungeId_code_key" ON "Device"("loungeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Device_loungeId_name_key" ON "Device"("loungeId", "name");

-- CreateIndex
CREATE INDEX "PricingRule_loungeId_isActive_priority_idx" ON "PricingRule"("loungeId", "isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");

-- CreateIndex
CREATE INDEX "Booking_deviceId_scheduledStart_scheduledEnd_idx" ON "Booking"("deviceId", "scheduledStart", "scheduledEnd");

-- CreateIndex
CREATE INDEX "Booking_loungeId_status_scheduledStart_idx" ON "Booking"("loungeId", "status", "scheduledStart");

-- CreateIndex
CREATE INDEX "Booking_customerId_scheduledStart_idx" ON "Booking"("customerId", "scheduledStart");

-- CreateIndex
CREATE INDEX "BookingExtension_bookingId_idx" ON "BookingExtension"("bookingId");

-- CreateIndex
CREATE INDEX "MenuItem_loungeId_category_isAvailable_idx" ON "MenuItem"("loungeId", "category", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_loungeId_sku_key" ON "MenuItem"("loungeId", "sku");

-- CreateIndex
CREATE INDEX "CanteenOrder_loungeId_createdAt_idx" ON "CanteenOrder"("loungeId", "createdAt");

-- CreateIndex
CREATE INDEX "CanteenOrder_bookingId_idx" ON "CanteenOrder"("bookingId");

-- CreateIndex
CREATE INDEX "CanteenOrderItem_orderId_idx" ON "CanteenOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "CanteenOrderItem_menuItemId_idx" ON "CanteenOrderItem"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Transaction_loungeId_createdAt_idx" ON "Transaction"("loungeId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_bookingId_idx" ON "Transaction"("bookingId");

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_provider_providerRef_key" ON "Transaction"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "Payout_organizationId_periodStart_idx" ON "Payout"("organizationId", "periodStart");

-- CreateIndex
CREATE INDEX "AuditLog_loungeId_createdAt_idx" ON "AuditLog"("loungeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lounge" ADD CONSTRAINT "Lounge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoungePhoto" ADD CONSTRAINT "LoungePhoto_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningHours" ADD CONSTRAINT "OpeningHours_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoungeMember" ADD CONSTRAINT "LoungeMember_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoungeMember" ADD CONSTRAINT "LoungeMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorZone" ADD CONSTRAINT "FloorZone_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCategory" ADD CONSTRAINT "DeviceCategory_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DeviceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "FloorZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DeviceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingExtension" ADD CONSTRAINT "BookingExtension_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingExtension" ADD CONSTRAINT "BookingExtension_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenOrder" ADD CONSTRAINT "CanteenOrder_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenOrder" ADD CONSTRAINT "CanteenOrder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenOrder" ADD CONSTRAINT "CanteenOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenOrder" ADD CONSTRAINT "CanteenOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenOrderItem" ADD CONSTRAINT "CanteenOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CanteenOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenOrderItem" ADD CONSTRAINT "CanteenOrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_canteenOrderId_fkey" FOREIGN KEY ("canteenOrderId") REFERENCES "CanteenOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Hand-written constraints Prisma cannot express in schema.prisma.
-- Keep these when regenerating the init migration.
-- =============================================================================

-- A device can never hold two overlapping live bookings. Half-open ranges
-- ('[)') let one session end at 18:00 and the next start at 18:00.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap_per_device"
  EXCLUDE USING gist (
    "deviceId" WITH =,
    tsrange("scheduledStart", "scheduledEnd", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'ACTIVE'));

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_time_order_chk" CHECK ("scheduledEnd" > "scheduledStart"),
  ADD CONSTRAINT "Booking_players_chk" CHECK ("players" >= 1),
  ADD CONSTRAINT "Booking_money_chk" CHECK (
    "hourlyRate" >= 0 AND "playSubtotal" >= 0 AND "canteenSubtotal" >= 0
    AND "discountTotal" >= 0 AND "taxTotal" >= 0 AND "totalPrice" >= 0 AND "amountPaid" >= 0
  );

ALTER TABLE "OpeningHours"
  ADD CONSTRAINT "OpeningHours_day_chk" CHECK ("dayOfWeek" BETWEEN 0 AND 6),
  ADD CONSTRAINT "OpeningHours_minutes_chk" CHECK (
    "opensAtMinute" BETWEEN 0 AND 1439 AND "closesAtMinute" BETWEEN 0 AND 1440
  );

ALTER TABLE "PricingRule"
  ADD CONSTRAINT "PricingRule_minutes_chk" CHECK (
    "startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 0 AND 1440
  ),
  ADD CONSTRAINT "PricingRule_one_price_chk" CHECK (
    ("hourlyRate" IS NOT NULL) <> ("multiplierBps" IS NOT NULL)
  );

ALTER TABLE "DeviceCategory"
  ADD CONSTRAINT "DeviceCategory_values_chk" CHECK (
    "baseHourlyRate" >= 0 AND "capacity" >= 1
    AND "minBookingMinutes" > 0 AND "slotIntervalMinutes" > 0
  );

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_price_chk" CHECK ("price" >= 0),
  ADD CONSTRAINT "MenuItem_stock_chk" CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0);

ALTER TABLE "CanteenOrderItem"
  ADD CONSTRAINT "CanteenOrderItem_qty_chk" CHECK ("quantity" > 0 AND "unitPrice" >= 0);

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_amount_chk" CHECK ("amount" > 0);

ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_balance_chk" CHECK ("balance" >= 0);

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_commission_chk" CHECK ("commissionRateBps" BETWEEN 0 AND 10000);
