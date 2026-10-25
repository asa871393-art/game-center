/**
 * Demo data for Firestore: platform admin, lounge owner, front-desk staff and the
 * demo player (a super admin, so one login can try everything), the Nexus
 * Gaming organization, two lounges with devices, pricing rules and a canteen menu.
 *
 *   npm run db:seed            (uses FIREBASE_* credentials from .env)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run db:seed
 *
 * Re-running rebuilds each demo lounge from scratch. Never run it against a
 * production project: it creates accounts with a published password.
 *
 * SEED_STAFF_EMAILS="ali@gmail.com,sara@gmail.com" also makes those Google accounts cashiers
 * (STAFF) at every demo lounge; they sign in with Gmail on /pos/login, no password.
 * For a live database use `npm run staff:grant` instead.
 */
import "dotenv/config";
import { hashPin, PIN_RESET_STATE } from "@/lib/pin";
import {
  DeviceType,
  LoungeMemberRole,
  LoungeStatus,
  MenuItemCategory,
  Role,
  SubscriptionPlan,
  SubscriptionStatus,
  type InputJsonValue,
} from "@/lib/db/types";
import { db } from "@/server/db";
import { grantLoungeAccess } from "@/server/services/staff-access";

/** Demo sign-in PINs (PIN is the only sign-in); re-seeding resets them and any PIN lockout. */
const DEMO_PINS = { admin: "2580", owner: "4826", staff: "1793", player: "3691" } as const;

async function upsertUser(email: string, name: string, role: Role, pin: string) {
  const pinData = { pinHash: await hashPin(pin), pinFailedAttempts: PIN_RESET_STATE.failures, pinLockedUntil: PIN_RESET_STATE.lockedUntil };
  return db.user.upsert({
    where: { email },
    update: { name, role, ...pinData },
    create: { email, name, role, emailVerified: new Date(), ...pinData },
  });
}

interface CategorySeed {
  key: "pc" | "ps5" | "vr" | "vip";
  name: string;
  type: DeviceType;
  rate: string;
  capacity?: number;
  minBookingMinutes?: number;
  /** POS price tiers (basis points of the hourly rate); omitted = tier not offered. */
  multiTierBps?: number;
  vipTierBps?: number;
  iconName: string;
  specs: { [key: string]: InputJsonValue };
}

const CATEGORIES: CategorySeed[] = [
  {
    key: "pc",
    name: "PC 240Hz",
    type: DeviceType.PC,
    rate: "3000",
    iconName: "monitor",
    specs: { cpu: "Ryzen 7 7800X3D", gpu: "RTX 4070 Super", monitorHz: 240, ramGb: 32 },
  },
  {
    key: "ps5",
    name: "PS5",
    type: DeviceType.CONSOLE,
    rate: "4000",
    capacity: 4,
    multiTierBps: 15000,
    vipTierBps: 20000,
    iconName: "gamepad-2",
    specs: { screen: '65" 4K', games: ["EA FC 25", "Tekken 8", "GTA V"] },
  },
  {
    key: "vr",
    name: "VR",
    type: DeviceType.VR,
    rate: "8000",
    minBookingMinutes: 30,
    iconName: "glasses",
    specs: { headset: "Meta Quest 3" },
  },
  {
    key: "vip",
    name: "VIP Room",
    type: DeviceType.VIP_ROOM,
    rate: "15000",
    capacity: 8,
    minBookingMinutes: 120,
    multiTierBps: 15000,
    iconName: "crown",
    specs: { screen: '85" 4K', consoles: ["PS5", "Xbox Series X"], seats: 8 },
  },
];

/** Menu sections, in display order. */
const MENU_CATEGORIES = [
  { key: "cold", name: "مشروبات باردة", nameEn: "Cold drinks", kind: MenuItemCategory.DRINK },
  { key: "hot", name: "مشروبات ساخنة", nameEn: "Hot drinks", kind: MenuItemCategory.DRINK },
  { key: "snacks", name: "سناكات", nameEn: "Snacks", kind: MenuItemCategory.SNACK },
  { key: "meals", name: "وجبات", nameEn: "Meals", kind: MenuItemCategory.MEAL },
  { key: "hookah", name: "أراكيل", nameEn: "Hookah", kind: MenuItemCategory.HOOKAH },
] as const;

type MenuSeed = {
  section: (typeof MENU_CATEGORIES)[number]["key"];
  name: string;
  nameEn: string;
  price: string;
  costPrice: string;
  sku: string;
  stockQuantity: number | null;
  iconName: string;
};

const MENU: MenuSeed[] = [
  { section: "cold", name: "ريد بول 250 مل", nameEn: "Red Bull 250ml", price: "2500", costPrice: "1500", sku: "DRK-RB250", stockQuantity: 48, iconName: "zap" },
  { section: "cold", name: "بيبسي", nameEn: "Pepsi", price: "1000", costPrice: "500", sku: "DRK-PEPSI", stockQuantity: 96, iconName: "cup-soda" },
  { section: "cold", name: "ماء 500 مل", nameEn: "Water 500ml", price: "500", costPrice: "200", sku: "DRK-H2O", stockQuantity: 120, iconName: "glass-water" },
  { section: "cold", name: "آيس لاتيه", nameEn: "Iced latte", price: "3500", costPrice: "1200", sku: "DRK-LATTE", stockQuantity: null, iconName: "coffee" },
  { section: "hot", name: "قهوة تركية", nameEn: "Turkish coffee", price: "2000", costPrice: "600", sku: "HOT-TURKISH", stockQuantity: null, iconName: "coffee" },
  { section: "hot", name: "شاي عراقي", nameEn: "Iraqi tea", price: "1000", costPrice: "250", sku: "HOT-TEA", stockQuantity: null, iconName: "cup-soda" },
  { section: "snacks", name: "دوريتوس", nameEn: "Doritos", price: "1500", costPrice: "900", sku: "SNK-DORITOS", stockQuantity: 40, iconName: "cookie" },
  { section: "snacks", name: "بوب كورن", nameEn: "Popcorn", price: "2000", costPrice: "500", sku: "SNK-POP", stockQuantity: null, iconName: "popcorn" },
  { section: "meals", name: "برغر دجاج", nameEn: "Chicken burger", price: "6000", costPrice: "3000", sku: "MEAL-BURGER", stockQuantity: null, iconName: "sandwich" },
  { section: "meals", name: "شريحة بيتزا", nameEn: "Pizza slice", price: "3500", costPrice: "1500", sku: "MEAL-PIZZA", stockQuantity: null, iconName: "pizza" },
  { section: "hookah", name: "أركيلة تفاحتين", nameEn: "Double apple hookah", price: "10000", costPrice: "3000", sku: "HKH-2APPLE", stockQuantity: null, iconName: "flame" },
  { section: "hookah", name: "أركيلة عنب ونعناع", nameEn: "Grape & mint hookah", price: "10000", costPrice: "3000", sku: "HKH-GRAPEMINT", stockQuantity: null, iconName: "flame" },
  { section: "hookah", name: "تبديل رأس أركيلة", nameEn: "Hookah head refill", price: "4000", costPrice: "1000", sku: "HKH-REFILL", stockQuantity: null, iconName: "flame" },
];

interface LoungeSeed {
  slug: string;
  name: string;
  description: string;
  city: string;
  addressLine: string;
  phone: string;
  latitude: number;
  longitude: number;
  /** Opening/closing minute; closing <= opening means after midnight. */
  hours: { opens: number; closes: number; closedOn?: number[] };
  pcs: number;
  ps5s: number;
  vrs: number;
  vips: number;
}

const LOUNGES: LoungeSeed[] = [
  {
    slug: "nexus-downtown",
    name: "Nexus Downtown",
    description: "ساحة PC بشاشات 240Hz، جلسات بلايستيشن 5، منطقة واقع افتراضي، وغرف VIP خاصة في قلب الكرادة.",
    city: "Baghdad",
    addressLine: "شارع الكرادة داخل 14",
    phone: "+964 770 000 0001",
    latitude: 33.3024,
    longitude: 44.4211,
    hours: { opens: 12 * 60, closes: 2 * 60 },
    pcs: 10,
    ps5s: 4,
    vrs: 2,
    vips: 2,
  },
  {
    slug: "nexus-mansour",
    name: "Nexus Mansour",
    description: "فرع المنصور: بلايستيشن وأجهزة PC بأجواء هادئة، مثالي للبطولات الصغيرة.",
    city: "Baghdad",
    addressLine: "شارع 14 رمضان، المنصور",
    phone: "+964 770 000 0002",
    latitude: 33.3152,
    longitude: 44.3366,
    hours: { opens: 14 * 60, closes: 0 },
    pcs: 6,
    ps5s: 6,
    vrs: 0,
    vips: 1,
  },
  {
    slug: "pixel-hub-erbil",
    name: "Pixel Hub Erbil",
    description: "أكبر صالة VR في أربيل مع أجهزة PC للمنافسات.",
    city: "Erbil",
    addressLine: "شارع 100، قرب عنكاوا",
    phone: "+964 750 000 0003",
    latitude: 36.2136,
    longitude: 44.0089,
    hours: { opens: 13 * 60, closes: 1 * 60, closedOn: [5] },
    pcs: 8,
    ps5s: 2,
    vrs: 4,
    vips: 0,
  },
];

async function seedLounge(organizationId: string, seed: LoungeSeed, members: { userId: string; role: LoungeMemberRole }[]) {
  const existing = await db.lounge.findUnique({ where: { slug: seed.slug } });
  if (existing) {
    // Re-running the seed rebuilds each demo lounge from scratch.
    await db.transaction.deleteMany({ where: { loungeId: existing.id } });
    await db.canteenOrder.deleteMany({ where: { loungeId: existing.id } });
    await db.booking.deleteMany({ where: { loungeId: existing.id } });
    await db.auditLog.deleteMany({ where: { loungeId: existing.id } });
    await db.lounge.delete({ where: { id: existing.id } });
  }

  const width = 20;
  const lounge = await db.lounge.create({
    data: {
      organizationId,
      name: seed.name,
      slug: seed.slug,
      description: seed.description,
      status: LoungeStatus.ACTIVE,
      addressLine: seed.addressLine,
      city: seed.city,
      country: "IQ",
      phone: seed.phone,
      latitude: seed.latitude,
      longitude: seed.longitude,
      timezone: "Asia/Baghdad",
      currency: "IQD",
      floorPlanWidth: width,
      floorPlanHeight: 12,
      openingHours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          opensAtMinute: seed.hours.opens,
          closesAtMinute: seed.hours.closes,
          isClosed: seed.hours.closedOn?.includes(dayOfWeek) ?? false,
        })),
      },
      members: { create: members },
      zones: {
        create: [
          { name: "PC Arena", color: "#6366f1", sortOrder: 0 },
          { name: "Console Lounge", color: "#0ea5e9", sortOrder: 1 },
          { name: "VR Bay", color: "#22c55e", sortOrder: 2 },
          { name: "VIP Wing", color: "#f59e0b", sortOrder: 3 },
        ],
      },
    },
    include: { zones: true },
  });
  const zone = (name: string) => lounge.zones.find((z) => z.name === name)!.id;

  const counts = { pc: seed.pcs, ps5: seed.ps5s, vr: seed.vrs, vip: seed.vips };
  const categoryIds: Partial<Record<CategorySeed["key"], string>> = {};
  for (const c of CATEGORIES) {
    if (counts[c.key] === 0) continue;
    const created = await db.deviceCategory.create({
      data: {
        loungeId: lounge.id,
        name: c.name,
        type: c.type,
        baseHourlyRate: c.rate,
        capacity: c.capacity ?? 1,
        minBookingMinutes: c.minBookingMinutes ?? 60,
        multiTierBps: c.multiTierBps ?? null,
        vipTierBps: c.vipTierBps ?? null,
        iconName: c.iconName,
        specs: c.specs,
      },
    });
    categoryIds[c.key] = created.id;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const devices = [
    // PCs: two rows of up to 5 on the left
    ...Array.from({ length: seed.pcs }, (_, i) => ({
      categoryId: categoryIds.pc!,
      zoneId: zone("PC Arena"),
      name: `PC-${pad(i + 1)}`,
      code: `PC${pad(i + 1)}`,
      ipAddress: `10.0.1.${11 + i}`,
      posX: 1 + (i % 5) * 2,
      posY: 1 + Math.floor(i / 5) * 2,
    })),
    // Consoles along the bottom
    ...Array.from({ length: seed.ps5s }, (_, i) => ({
      categoryId: categoryIds.ps5!,
      zoneId: zone("Console Lounge"),
      name: `PS5-${String.fromCharCode(65 + i)}`,
      code: `PS5${String.fromCharCode(65 + i)}`,
      posX: 1 + (i % 4) * 3,
      posY: 6 + Math.floor(i / 4) * 3,
      width: 2,
      height: 2,
    })),
    // VR top-right
    ...Array.from({ length: seed.vrs }, (_, i) => ({
      categoryId: categoryIds.vr!,
      zoneId: zone("VR Bay"),
      name: `VR-${i + 1}`,
      code: `VR${i + 1}`,
      posX: 12 + (i % 3) * 3,
      posY: 1 + Math.floor(i / 3) * 3,
      width: 2,
      height: 2,
    })),
    // VIP rooms bottom-right
    ...Array.from({ length: seed.vips }, (_, i) => ({
      categoryId: categoryIds.vip!,
      zoneId: zone("VIP Wing"),
      name: `VIP Room ${i + 1}`,
      code: `VIP${i + 1}`,
      posX: 13 + i * 3,
      posY: 7,
      width: 3,
      height: 4,
    })),
  ];
  await db.device.createMany({ data: devices.map((d) => ({ ...d, loungeId: lounge.id })) });

  // One device under maintenance so the floor plan shows a disabled state.
  if (seed.pcs > 0) {
    await db.device.update({
      where: { loungeId_code: { loungeId: lounge.id, code: `PC${pad(seed.pcs)}` } },
      data: { status: "MAINTENANCE" },
    });
  }

  await db.pricingRule.createMany({
    data: [
      {
        loungeId: lounge.id,
        name: "Weekday afternoon discount",
        daysOfWeek: [0, 1, 2, 3],
        startMinute: 12 * 60,
        endMinute: 16 * 60,
        multiplierBps: 8000,
        priority: 10,
      },
      ...(categoryIds.pc
        ? [
            {
              loungeId: lounge.id,
              categoryId: categoryIds.pc,
              name: "Weekend night PC peak",
              // Thursday & Friday nights (Iraqi weekend is Fri/Sat)
              daysOfWeek: [4, 5],
              startMinute: 20 * 60,
              endMinute: 24 * 60,
              hourlyRate: "4000",
              priority: 20,
            },
          ]
        : []),
    ],
  });

  const sections = new Map<string, { id: string; kind: MenuItemCategory }>();
  for (const [sortOrder, c] of MENU_CATEGORIES.entries()) {
    const created = await db.menuCategory.create({
      data: { loungeId: lounge.id, name: c.name, nameEn: c.nameEn, kind: c.kind, sortOrder },
    });
    sections.set(c.key, { id: created.id, kind: c.kind });
  }
  await db.menuItem.createMany({
    data: MENU.map(({ section, ...item }, sortOrder) => ({
      ...item,
      loungeId: lounge.id,
      menuCategoryId: sections.get(section)!.id,
      category: sections.get(section)!.kind,
      sortOrder,
    })),
  });

  return { lounge, deviceCount: devices.length };
}

async function main() {
  const superAdmin = await upsertUser("admin@gamelounge.dev", "Platform Admin", Role.SUPER_ADMIN, DEMO_PINS.admin);
  const owner = await upsertUser("owner@gamelounge.dev", "Lounge Owner", Role.LOUNGE_ADMIN, DEMO_PINS.owner);
  const staff = await upsertUser("staff@gamelounge.dev", "Front Desk", Role.STAFF, DEMO_PINS.staff);
  // Super admin too, so one login can book as a player and manage every lounge (POS, devices, menu).
  const customer = await upsertUser("player@gamelounge.dev", "Demo Player", Role.SUPER_ADMIN, DEMO_PINS.player);

  await db.wallet.upsert({
    where: { userId: customer.id },
    update: { currency: "IQD" },
    create: { userId: customer.id, balance: "50000", currency: "IQD" },
  });

  const org = await db.organization.upsert({
    where: { slug: "nexus-gaming" },
    update: {},
    create: { name: "Nexus Gaming", slug: "nexus-gaming", ownerId: owner.id, commissionRateBps: 1000 },
  });

  if ((await db.subscription.count({ where: { organizationId: org.id } })) === 0) {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await db.subscription.create({
      data: {
        organizationId: org.id,
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.ACTIVE,
        priceMonthly: "79.00",
        currency: "USD",
        maxLounges: 5,
        maxDevices: 100,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });
  }

  const members = [
    { userId: owner.id, role: LoungeMemberRole.OWNER },
    { userId: staff.id, role: LoungeMemberRole.STAFF },
  ];

  const staffEmails = (process.env.SEED_STAFF_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  console.log("Seed complete.");
  for (const seed of LOUNGES) {
    const { lounge, deviceCount } = await seedLounge(org.id, seed, members);
    console.log(`  ${lounge.name.padEnd(18)} /${lounge.slug} · ${seed.city} · ${deviceCount} devices`);
    for (const email of staffEmails) await grantLoungeAccess({ loungeId: lounge.id, actorId: null }, { email, role: "STAFF" });
  }
  if (staffEmails.length) console.log(`  Extra cashiers (no PIN yet; set one with staff:grant --pin): ${staffEmails.join(", ")}`);
  console.log("  PIN sign-in on /pos/login:");
  const pins = [
    [superAdmin, DEMO_PINS.admin],
    [owner, DEMO_PINS.owner],
    [staff, DEMO_PINS.staff],
    [customer, DEMO_PINS.player],
  ] as const;
  for (const [u, pin] of pins) console.log(`    ${u.role.padEnd(12)} ${(u.name ?? "").padEnd(15)} PIN ${pin}  (${u.email})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
