import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import {
  DeviceType,
  LoungeMemberRole,
  LoungeStatus,
  MenuItemCategory,
  Prisma,
  PrismaClient,
  Role,
  SubscriptionPlan,
  SubscriptionStatus,
} from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEMO_PASSWORD = "Password123!";

async function upsertUser(email: string, name: string, role: Role, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: { name, role },
    create: { email, name, role, passwordHash, emailVerified: new Date() },
  });
}

interface CategorySeed {
  key: "pc" | "ps5" | "vr" | "vip";
  name: string;
  type: DeviceType;
  rate: string;
  capacity?: number;
  minBookingMinutes?: number;
  iconName: string;
  specs: Prisma.InputJsonObject;
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
    iconName: "crown",
    specs: { screen: '85" 4K', consoles: ["PS5", "Xbox Series X"], seats: 8 },
  },
];

const MENU = [
  { name: "ريد بول 250 مل", category: MenuItemCategory.DRINK, price: "2500", sku: "DRK-RB250", stockQuantity: 48 },
  { name: "بيبسي", category: MenuItemCategory.DRINK, price: "1000", sku: "DRK-PEPSI", stockQuantity: 96 },
  { name: "ماء 500 مل", category: MenuItemCategory.DRINK, price: "500", sku: "DRK-H2O", stockQuantity: 120 },
  { name: "آيس لاتيه", category: MenuItemCategory.DRINK, price: "3500", sku: "DRK-LATTE", stockQuantity: null },
  { name: "دوريتوس", category: MenuItemCategory.SNACK, price: "1500", sku: "SNK-DORITOS", stockQuantity: 40 },
  { name: "بوب كورن", category: MenuItemCategory.SNACK, price: "2000", sku: "SNK-POP", stockQuantity: null },
  { name: "برغر دجاج", category: MenuItemCategory.MEAL, price: "6000", sku: "MEAL-BURGER", stockQuantity: null },
  { name: "شريحة بيتزا", category: MenuItemCategory.MEAL, price: "3500", sku: "MEAL-PIZZA", stockQuantity: null },
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
  const existing = await prisma.lounge.findUnique({ where: { slug: seed.slug } });
  if (existing) {
    // Re-running the seed rebuilds each demo lounge from scratch.
    await prisma.$transaction([
      prisma.transaction.deleteMany({ where: { loungeId: existing.id } }),
      prisma.canteenOrder.deleteMany({ where: { loungeId: existing.id } }),
      prisma.booking.deleteMany({ where: { loungeId: existing.id } }),
      prisma.lounge.delete({ where: { id: existing.id } }),
    ]);
  }

  const width = 20;
  const lounge = await prisma.lounge.create({
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
    const created = await prisma.deviceCategory.create({
      data: {
        loungeId: lounge.id,
        name: c.name,
        type: c.type,
        baseHourlyRate: c.rate,
        capacity: c.capacity ?? 1,
        minBookingMinutes: c.minBookingMinutes ?? 60,
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
  await prisma.device.createMany({ data: devices.map((d) => ({ ...d, loungeId: lounge.id })) });

  // One device under maintenance so the floor plan shows a disabled state.
  if (seed.pcs > 0) {
    await prisma.device.update({
      where: { loungeId_code: { loungeId: lounge.id, code: `PC${pad(seed.pcs)}` } },
      data: { status: "MAINTENANCE" },
    });
  }

  await prisma.pricingRule.createMany({
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

  await prisma.menuItem.createMany({
    data: MENU.map((item, sortOrder) => ({ ...item, loungeId: lounge.id, sortOrder })),
  });

  return { lounge, deviceCount: devices.length };
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const superAdmin = await upsertUser("admin@gamelounge.dev", "Platform Admin", Role.SUPER_ADMIN, passwordHash);
  const owner = await upsertUser("owner@gamelounge.dev", "Lounge Owner", Role.LOUNGE_ADMIN, passwordHash);
  const staff = await upsertUser("staff@gamelounge.dev", "Front Desk", Role.STAFF, passwordHash);
  const customer = await upsertUser("player@gamelounge.dev", "Demo Player", Role.CUSTOMER, passwordHash);

  await prisma.wallet.upsert({
    where: { userId: customer.id },
    update: { currency: "IQD" },
    create: { userId: customer.id, balance: "50000", currency: "IQD" },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "nexus-gaming" },
    update: {},
    create: { name: "Nexus Gaming", slug: "nexus-gaming", ownerId: owner.id, commissionRateBps: 1000 },
  });

  if ((await prisma.subscription.count({ where: { organizationId: org.id } })) === 0) {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await prisma.subscription.create({
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

  console.log("Seed complete.");
  for (const seed of LOUNGES) {
    const { lounge, deviceCount } = await seedLounge(org.id, seed, members);
    console.log(`  ${lounge.name.padEnd(18)} /${lounge.slug} · ${seed.city} · ${deviceCount} devices`);
  }
  console.log(`  Logins (password "${DEMO_PASSWORD}"):`);
  for (const u of [superAdmin, owner, staff, customer]) console.log(`    ${u.role.padEnd(12)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
