// Generated from the former prisma/schema.prisma; now maintained by hand.
// Model shapes as the data layer returns them (src/server/db). Money fields are
// Decimal, timestamps are Date. Safe to import from Client Components.

import type { Decimal } from "./decimal";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type InputJsonValue = string | number | boolean | InputJsonValue[] | { [key: string]: InputJsonValue | null };

export const Role = {
  SUPER_ADMIN: "SUPER_ADMIN",
  LOUNGE_ADMIN: "LOUNGE_ADMIN",
  STAFF: "STAFF",
  CUSTOMER: "CUSTOMER",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const LoungeMemberRole = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  STAFF: "STAFF",
} as const;
export type LoungeMemberRole = (typeof LoungeMemberRole)[keyof typeof LoungeMemberRole];

export const OrganizationStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CLOSED: "CLOSED",
} as const;
export type OrganizationStatus = (typeof OrganizationStatus)[keyof typeof OrganizationStatus];

export const SubscriptionPlan = {
  STARTER: "STARTER",
  PRO: "PRO",
  ENTERPRISE: "ENTERPRISE",
} as const;
export type SubscriptionPlan = (typeof SubscriptionPlan)[keyof typeof SubscriptionPlan];

export const SubscriptionStatus = {
  TRIALING: "TRIALING",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELLED: "CANCELLED",
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const LoungeStatus = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CLOSED: "CLOSED",
} as const;
export type LoungeStatus = (typeof LoungeStatus)[keyof typeof LoungeStatus];

export const DeviceType = {
  PC: "PC",
  CONSOLE: "CONSOLE",
  VR: "VR",
  VIP_ROOM: "VIP_ROOM",
  SIMULATOR: "SIMULATOR",
  OTHER: "OTHER",
} as const;
export type DeviceType = (typeof DeviceType)[keyof typeof DeviceType];

export const DeviceStatus = {
  IDLE: "IDLE",
  IN_USE: "IN_USE",
  RESERVED: "RESERVED",
  MAINTENANCE: "MAINTENANCE",
  OFFLINE: "OFFLINE",
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

export const BookingStatus = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const SessionMode = {
  FIXED: "FIXED",
  OPEN: "OPEN",
} as const;
export type SessionMode = (typeof SessionMode)[keyof typeof SessionMode];

export const PriceTier = {
  SINGLE: "SINGLE",
  MULTI: "MULTI",
  VIP: "VIP",
} as const;
export type PriceTier = (typeof PriceTier)[keyof typeof PriceTier];

export const BookingSource = {
  ONLINE: "ONLINE",
  WALK_IN: "WALK_IN",
  PHONE: "PHONE",
} as const;
export type BookingSource = (typeof BookingSource)[keyof typeof BookingSource];

export const PaymentStatus = {
  UNPAID: "UNPAID",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const CheckoutMethod = {
  PAY_AT_LOUNGE: "PAY_AT_LOUNGE",
  ZAINCASH: "ZAINCASH",
  FASTPAY: "FASTPAY",
} as const;
export type CheckoutMethod = (typeof CheckoutMethod)[keyof typeof CheckoutMethod];

export const MenuItemCategory = {
  DRINK: "DRINK",
  SNACK: "SNACK",
  MEAL: "MEAL",
  DESSERT: "DESSERT",
  HOOKAH: "HOOKAH",
  OTHER: "OTHER",
} as const;
export type MenuItemCategory = (typeof MenuItemCategory)[keyof typeof MenuItemCategory];

export const ShiftStatus = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
} as const;
export type ShiftStatus = (typeof ShiftStatus)[keyof typeof ShiftStatus];

export const ShiftType = {
  MORNING: "MORNING",
  EVENING: "EVENING",
} as const;
export type ShiftType = (typeof ShiftType)[keyof typeof ShiftType];

export const CanteenOrderStatus = {
  PENDING: "PENDING",
  PREPARING: "PREPARING",
  SERVED: "SERVED",
  CANCELLED: "CANCELLED",
} as const;
export type CanteenOrderStatus = (typeof CanteenOrderStatus)[keyof typeof CanteenOrderStatus];

export const TransactionType = {
  PAYMENT: "PAYMENT",
  REFUND: "REFUND",
  WALLET_TOPUP: "WALLET_TOPUP",
  COMMISSION: "COMMISSION",
  PAYOUT: "PAYOUT",
  ADJUSTMENT: "ADJUSTMENT",
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const PaymentMethod = {
  CASH: "CASH",
  CARD: "CARD",
  WALLET: "WALLET",
  ONLINE: "ONLINE",
  ZAINCASH: "ZAINCASH",
  FASTPAY: "FASTPAY",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const TransactionStatus = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

export const PayoutStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PAID: "PAID",
  FAILED: "FAILED",
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export interface User {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: Date | null;
  phone: string | null;
  image: string | null;
  /** bcrypt hash for credentials login; null for OAuth-only users. */
  passwordHash: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Account {
  /** Document id (derived from provider + providerAccountId). */
  id: string;
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  refresh_token: string | null;
  access_token: string | null;
  expires_at: number | null;
  token_type: string | null;
  scope: string | null;
  id_token: string | null;
  session_state: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  sessionToken: string;
  userId: string;
  expires: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerificationToken {
  /** Document id (derived from identifier + token). */
  id: string;
  identifier: string;
  token: string;
  expires: Date;
}

/** A tenant: one business that may run several lounge branches. */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  ownerId: string;
  /** Platform commission on online bookings, in basis points (1000 = 10%). */
  commissionRateBps: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subscription {
  id: string;
  organizationId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  /** Monthly fee charged by the platform. */
  priceMonthly: Decimal;
  currency: string;
  maxLounges: number;
  maxDevices: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Lounge {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  status: LoungeStatus;
  addressLine: string;
  city: string;
  region: string | null;
  country: string;
  postalCode: string | null;
  latitude: number;
  longitude: number;
  /** IANA timezone, e.g. "Asia/Baghdad". Used for opening hours and pricing windows. */
  timezone: string;
  phone: string | null;
  email: string | null;
  currency: string;
  /** Tax applied on top of subtotals, in basis points (1500 = 15%). */
  taxRateBps: number;
  coverImageUrl: string | null;
  floorPlanWidth: number;
  floorPlanHeight: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoungePhoto {
  id: string;
  loungeId: string;
  url: string;
  alt: string | null;
  sortOrder: number;
  createdAt: Date;
}

/** Weekly opening hours. closesAtMinute <= opensAtMinute means the lounge closes after midnight (overnight shift). */
export interface OpeningHours {
  id: string;
  loungeId: string;
  /** 0 = Sunday ... 6 = Saturday */
  dayOfWeek: number;
  opensAtMinute: number;
  closesAtMinute: number;
  isClosed: boolean;
}

/** Staff/manager/owner access to a lounge. */
export interface LoungeMember {
  id: string;
  loungeId: string;
  userId: string;
  role: LoungeMemberRole;
  isActive: boolean;
  createdAt: Date;
}

/** Named area on the floor plan, e.g. "Main Hall", "VIP Wing". */
export interface FloorZone {
  id: string;
  loungeId: string;
  name: string;
  color: string | null;
  sortOrder: number;
}

/** Per-lounge category such as "PC 240Hz", "PS5", "VR", "VIP Room". */
export interface DeviceCategory {
  id: string;
  loungeId: string;
  name: string;
  type: DeviceType;
  description: string | null;
  /** Default price per hour before pricing rules are applied. */
  baseHourlyRate: Decimal;
  /** Max players per device/room (e.g. 4 for a PS5 couch, 8 for a VIP room). */
  capacity: number;
  minBookingMinutes: number;
  /** Booking start times snap to this grid (e.g. 30 = :00 / :30). */
  slotIntervalMinutes: number;
  /** Rate multiplier for the MULTI tier (e.g. 15000 = 1.5x for 4 controllers); null = not offered. */
  multiTierBps: number | null;
  /** Rate multiplier for the VIP tier; null = not offered. */
  vipTierBps: number | null;
  /** Free-form specs shown to customers: { gpu, cpu, monitorHz, games: [] ... } */
  specs: JsonValue | null;
  iconName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Device {
  id: string;
  loungeId: string;
  categoryId: string;
  zoneId: string | null;
  /** Human label shown on the grid, e.g. "PC-07", "PS5-A", "VIP Room 2". */
  name: string;
  /** Short stable code used by POS/hardware agents. */
  code: string;
  status: DeviceStatus;
  ipAddress: string | null;
  macAddress: string | null;
  /** Overrides/extends the category specs for this unit. */
  specs: JsonValue | null;
  notes: string | null;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  isBookableOnline: boolean;
  lastSeenAt: Date | null;
  /** Per-device pricing; null = use the category's. Tier overrides are multipliers like the category's. */
  hourlyRateOverride: Decimal | null;
  multiTierBpsOverride: number | null;
  vipTierBpsOverride: number | null;
  /** Archived devices keep their booking history but leave the floor, POS and booking site. */
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Time/day-based price override. The highest-priority active rule matching a slot wins; if none match, DeviceCategory.baseHourlyRate is used. */
export interface PricingRule {
  id: string;
  loungeId: string;
  /** null = applies to every category in the lounge. */
  categoryId: string | null;
  name: string;
  /** Days the rule applies to (0 = Sunday ... 6 = Saturday). Empty = every day. */
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  /** Exactly one of hourlyRate / multiplierBps should be set. */
  hourlyRate: Decimal | null;
  /** 10000 = 1.0x, 8000 = 20% off, 12500 = +25% peak surcharge. */
  multiplierBps: number | null;
  priority: number;
  validFrom: Date | null;
  validTo: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Booking {
  id: string;
  /** Short human reference shown on receipts, e.g. "GL-7K3P9Q". */
  reference: string;
  loungeId: string;
  deviceId: string;
  /** null for anonymous walk-ins. */
  customerId: string | null;
  /** Staff member who created it (walk-ins / phone bookings). */
  createdById: string | null;
  source: BookingSource;
  status: BookingStatus;
  mode: SessionMode;
  priceTier: PriceTier;
  guestName: string | null;
  guestPhone: string | null;
  players: number;
  /** For OPEN sessions scheduledEnd is only a reservation horizon (next booking or closing time). */
  scheduledStart: Date;
  scheduledEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
  /** Set while the session is paused; the seat stays reserved but the clock stops. */
  pausedAt: Date | null;
  pausedMinutes: number;
  currency: string;
  hourlyRate: Decimal;
  playSubtotal: Decimal;
  canteenSubtotal: Decimal;
  discountTotal: Decimal;
  taxTotal: Decimal;
  totalPrice: Decimal;
  amountPaid: Decimal;
  paymentStatus: PaymentStatus;
  checkoutMethod: CheckoutMethod;
  /** Unpaid online-checkout holds are released after this instant. */
  expiresAt: Date | null;
  notes: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** Optimistic-concurrency counter; bump on every POS mutation. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Audit of "Extend +1hr" actions on a session. */
export interface BookingExtension {
  id: string;
  bookingId: string;
  minutes: number;
  price: Decimal;
  previousEnd: Date;
  newEnd: Date;
  addedById: string | null;
  createdAt: Date;
}

/** A stretch of play on one device at one tier. A new segment starts on check-in/start, resume, tier change and transfer; pausing or checkout ends it. OPEN sessions are billed as the sum of segment amounts. */
export interface SessionSegment {
  id: string;
  bookingId: string;
  deviceId: string;
  priceTier: PriceTier;
  startedAt: Date;
  /** null while the segment is running. */
  endedAt: Date | null;
  /** Billable minutes and price, set when the segment ends. */
  minutes: number | null;
  amount: Decimal | null;
  createdAt: Date;
}

/** A lounge's own menu section, e.g. "مشروبات باردة / Cold drinks". `kind` is the broad type, used for the default icon and reporting. */
export interface MenuCategory {
  id: string;
  loungeId: string;
  /** Arabic (primary) and optional English display names. */
  name: string;
  nameEn: string | null;
  kind: MenuItemCategory;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuItem {
  id: string;
  loungeId: string;
  menuCategoryId: string;
  /** Arabic (primary) and optional English names. */
  name: string;
  nameEn: string | null;
  description: string | null;
  /** Broad type, mirrored from the menu category's kind. */
  category: MenuItemCategory;
  price: Decimal;
  /** Purchase cost, for margin reporting; never shown to customers. */
  costPrice: Decimal | null;
  imageUrl: string | null;
  /** lucide icon name shown when there's no image. */
  iconName: string | null;
  sku: string | null;
  /** null = stock not tracked (e.g. fresh coffee). */
  stockQuantity: number | null;
  /** "Low stock" at or below this quantity. */
  lowStockAt: number;
  isAvailable: boolean;
  sortOrder: number;
  /** Archived items keep their order history but leave the menu. */
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A canteen order. Usually attached to a Booking (pre-order or added to an active seat from the POS); bookingId is null for counter sales. */
export interface CanteenOrder {
  id: string;
  loungeId: string;
  bookingId: string | null;
  customerId: string | null;
  createdById: string | null;
  status: CanteenOrderStatus;
  /** Ordered in advance with an online booking; served when the session starts. */
  isPreOrder: boolean;
  subtotal: Decimal;
  taxTotal: Decimal;
  total: Decimal;
  notes: string | null;
  servedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CanteenOrderItem {
  id: string;
  orderId: string;
  menuItemId: string;
  /** Snapshots so receipts survive menu edits. */
  name: string;
  unitPrice: Decimal;
  quantity: number;
  lineTotal: Decimal;
}

export interface Wallet {
  id: string;
  userId: string;
  balance: Decimal;
  currency: string;
  updatedAt: Date;
}

/** Immutable payment ledger. Amounts are always positive; direction is given by `type` (REFUND / PAYOUT move money out). */
export interface Transaction {
  id: string;
  loungeId: string | null;
  bookingId: string | null;
  canteenOrderId: string | null;
  payoutId: string | null;
  /** Counter payments belong to the cashier shift that took them (cash drawer reconciliation). */
  shiftId: string | null;
  userId: string | null;
  processedById: string | null;
  type: TransactionType;
  method: PaymentMethod;
  status: TransactionStatus;
  amount: Decimal;
  currency: string;
  /** Payment gateway name and its reference, for reconciliation/idempotency. */
  provider: string | null;
  providerRef: string | null;
  metadata: JsonValue | null;
  createdAt: Date;
}

/** A cashier shift: opened with a cash float, closed by counting the drawer. expectedCash = openingFloat + cash taken during the shift; variance = counted - expected. */
export interface Shift {
  id: string;
  loungeId: string;
  cashierId: string;
  status: ShiftStatus;
  /** Morning or evening. Null only on shifts opened before shift types existed; see resolveShiftType. */
  shiftType: ShiftType | null;
  openedAt: Date;
  closedAt: Date | null;
  closedById: string | null;
  openingFloat: Decimal;
  /** Snapshots taken at close. */
  expectedCash: Decimal | null;
  countedCash: Decimal | null;
  variance: Decimal | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Cash paid out of the drawer during a shift (ice, delivery, small repairs). Lowers expected cash. Mistakes are voided, not deleted, so the Z-report and audit trail keep them. */
export interface ShiftExpense {
  id: string;
  shiftId: string;
  loungeId: string;
  amount: Decimal;
  reason: string;
  createdById: string;
  createdAt: Date;
  voidedAt: Date | null;
  voidedById: string | null;
}

/** Platform -> organization settlement for online payments, net of commission. */
export interface Payout {
  id: string;
  organizationId: string;
  periodStart: Date;
  periodEnd: Date;
  grossAmount: Decimal;
  commissionAmount: Decimal;
  netAmount: Decimal;
  currency: string;
  status: PayoutStatus;
  paidAt: Date | null;
  externalRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  loungeId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  data: JsonValue | null;
  createdAt: Date;
}

export interface ModelTypes {
  User: User;
  Account: Account;
  Session: Session;
  VerificationToken: VerificationToken;
  Organization: Organization;
  Subscription: Subscription;
  Lounge: Lounge;
  LoungePhoto: LoungePhoto;
  OpeningHours: OpeningHours;
  LoungeMember: LoungeMember;
  FloorZone: FloorZone;
  DeviceCategory: DeviceCategory;
  Device: Device;
  PricingRule: PricingRule;
  Booking: Booking;
  BookingExtension: BookingExtension;
  SessionSegment: SessionSegment;
  MenuCategory: MenuCategory;
  MenuItem: MenuItem;
  CanteenOrder: CanteenOrder;
  CanteenOrderItem: CanteenOrderItem;
  Wallet: Wallet;
  Transaction: Transaction;
  Shift: Shift;
  ShiftExpense: ShiftExpense;
  Payout: Payout;
  AuditLog: AuditLog;
}

export type ModelName = keyof ModelTypes;
