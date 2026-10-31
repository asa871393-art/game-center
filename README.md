# الاساس (Al-Asas) — Gaming Lounge Cashier POS

Cashier point of sale for a single gaming lounge branch (PC arenas, PlayStation, VR, VIP rooms): sessions on the
device floor, canteen sales, shifts and the cash drawer, device and menu management, and staff with PIN sign-in.
Arabic (RTL) is the default language; English is included.

Customer-facing booking, online payments and the multi-branch platform admin were removed on 2026-10-31. They are in
the git history up to commit `6f55a61` if they are ever needed again.

**Stack:** Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind v4 · shadcn/ui (Base UI, RTL) ·
Firebase Firestore (Admin SDK) · Auth.js v5 · Vitest

## Getting started

```bash
cp .env.example .env          # then set AUTH_SECRET (npx auth secret, or openssl rand -base64 32)
npm install
```

Then either use a Firebase project (set `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY` in `.env`, see [Firebase](#firebase)) or the local emulator (needs Java 21+):

```bash
npm run db:emulator           # Firestore emulator on 127.0.0.1:8085 (keep it running)
# in .env: FIRESTORE_EMULATOR_HOST="127.0.0.1:8085"
npm run db:seed               # 3 lounges (Baghdad ×2, Erbil), menus, 4 users
npm run dev                   # http://localhost:3000 → redirects to /ar
```

Demo PIN sign-in on `/ar/pos/login` (pick the name, type the PIN): Platform Admin `2580`, Lounge Owner `4826`,
Front Desk `1793`, Demo Player `3691`.
`player@` is also a super admin, so it can manage every lounge's POS, devices and menu. The emulator keeps no data
between runs; seed again after restarting it.

## Scripts

| Script | Purpose |
| --- | --- |
| `test` | Unit tests (pricing, timezones, opening hours, business day, bill totals, money) |
| `test:integration` | Starts the Firestore emulator, seeds it, runs the POS, devices, menu, staff, realtime and data-layer suites |
| `typecheck` / `lint` / `build` | Static checks and production build (no Firebase credentials needed) |
| `db:emulator` | Local Firestore emulator (port 8085) |
| `db:seed` | Demo data into the configured project, or the emulator when `FIRESTORE_EMULATOR_HOST` is set (`SEED_STAFF_EMAILS` adds cashiers without a PIN) |
| `staff:grant` | Gives an account cashier/manager/super-admin access and its PIN: `npm run staff:grant -- ali@example.com [--lounge <slug>] [--role MANAGER\|SUPER_ADMIN] [--pin 4821]`, or `-- --list` |
| `firestore:deploy` | Deploys `firestore.rules` and `firestore.indexes.json` (`firebase login` first) |

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests and the build, plus the integration
suite on the emulator, on every pull request and on pushes to `main`.

Integration tests never touch a real project: they refuse to start without `FIRESTORE_EMULATOR_HOST` and drop the
service-account variables. The emulator needs a Java 21+ runtime on `PATH`.

## Lounge dashboard

Sign in as `staff@` or `owner@` and open **Dashboard** from the user menu (`/[locale]/manage`). With one lounge you go
straight to its board (`/[locale]/manage/[loungeId]`); super admins see every lounge.

- **Stats:** revenue today (successful payments minus refunds), devices in use, upcoming and completed sessions, canteen
  sales. "Today" is the **business day**, so 01:00 on an overnight shift still counts towards yesterday.
- **Floor:** live map with a countdown on every running session and an overtime warning. A seat is *reserved* when a
  booking starts within 30 minutes. Click a device to open its panel:
  - **Walk-in:** pick the duration (capped by the next booking or closing time) and the players. The price preview uses
    the same pricing code as the server.
  - **Running session:** extend by 30 min or 1 hr (priced at the rates in force then), add canteen orders to the bill,
    void unserved orders, and **check out** with cash or card. Checkout must collect exactly the balance due.
  - **Next booking:** check in (from 30 min before the start), mark no-show (15 min after the start), or cancel if unpaid.
    No-show and cancel put pre-orders back into stock.
  - **Device status** (manager/owner only): maintenance, offline, or back in service. A busy seat can't be taken out.
- **Today's bookings:** the day's schedule with booking and payment status. Click a row to open that device.
- **Canteen:** queue of orders to serve (pre-orders appear once the guest is seated), counter sales paid on the spot,
  and low-stock items.

The board updates live (see below), and after every action.

**Rules** (`src/server/services/pos.ts`):
- Every booking mutation checks `Booking.version`, so if two tablets act on the same seat, one gets "changed on another
  device" and a refreshed screen.
- The overlap constraint still applies: an extension can't run into the next booking.
- Access comes from `LoungeMember` in the database on every request (`src/server/staff.ts`), not from the JWT.
- Each action writes an `AuditLog` row (`session.start`, `session.extend`, `session.end`, `canteen.order`, …).

## Cashier POS terminal

`/[locale]/pos/[loungeId]` is a full-screen, always-dark, touch-first screen for cashiers. It has no customer header
or footer and works in Arabic (RTL) and English. Open it from the user menu (**Point of sale**), or go to `/pos` to pick
a lounge.

- **Device grid:** large tiles filtered by device type. Each tile shows its state (free, running, paused, overtime,
  reserved, maintenance), the session type (**Open time** counts up, **Fixed time** counts down), the price tier and the
  **current charge**, all live.
- **Quick actions** (tap a tile):
  - *Start session:* open or fixed time, price tier, players, guest name. Rates shown include time-of-day pricing.
  - *Check in*, *no-show* or *cancel* the next booking.
  - *Add items* from the canteen to the bill.
  - *Change tier* (Single / Multi / VIP). Open sessions bill the new rate from now on; fixed sessions reprice the
    remaining time.
  - *Pause / resume:* the clock stops and the seat stays held. A fixed session's end moves out by the paused time, up
    to the next booking or closing time.
  - *Transfer* to another free device. Time already played stays at the old device's rate.
  - *Extend* +30 min or +1 hr (fixed sessions).
  - *Checkout:* an itemized bill (gaming segments, canteen, tax), then payment split freely across **Cash / Card /
    ZainCash**, with cash given and change. Then print the receipt.
- **Counter sale** and the **orders queue** are in the top bar.

**Billing model** (`src/lib/booking/session-billing.ts`, shared by server and screen so the numbers always match):
- Each session is made of `SessionSegment`s, one per stretch of play on a device at a tier. Pause, tier change,
  transfer and checkout close the running segment.
- **Open sessions** are billed per started minute: Σ segment(time-of-day rules × tier multiplier).
- **Fixed sessions** keep the price snapshot from booking time, adjusted by extensions, tier changes and transfers.
- Tiers come from `DeviceCategory.multiTierBps` / `vipTierBps` (null means not offered). The demo has PS5 at Multi 1.5×
  and VIP 2×, and VIP rooms at Multi 1.5×.
- Checkout freezes an open session's bill at the moment checkout opened (`billUntil`, at most 10 minutes old), so the
  amount shown is the amount charged. Payments must add up exactly to the balance due.
- An open session holds its seat until the next booking or closing time. At checkout the hold shrinks to the actual
  end.
- **ZainCash at the counter** is recorded as `PaymentMethod.ZAINCASH`. It isn't connected to a ZainCash API; the cashier
  confirms the transfer.

**Shifts and the cash drawer** (`src/server/services/shift.ts`):
- A lounge has one drawer, so at most one **open shift** (enforced by a partial unique index). The top bar shows the
  shift's cashier, start time and **live cash in drawer**.
- Counter payments (Cash / ZainCash / FastPay / Card) need an open shift and are attached to it, so every payment
  lands in a drawer that gets counted.
- **Cash expenses** ("مصروف" in the top bar): cash paid out of the drawer (ice, delivery, repairs) with a reason.
  Stored in `ShiftExpense`; can't exceed the cash in the drawer; mistakes are voided (kept on record), and only while
  the shift is open. Adding/voiding expenses and closing lock the shift row, so they can't race each other.
- **Expected cash** = opening float + cash from gaming + cash from canteen − cash expenses. Cash is split by purpose:
  counter sales are canteen; a session payment is shared in proportion to the session's play and canteen subtotals.
- **Close shift:** the drawer is counted note by note (Iraqi dinar denominations) or entered as a total. It shows the
  expected-cash breakdown, counted cash and the variance (over / short), takings by payment method (Cash / ZainCash /
  FastPay / Card), sessions, counter sales, gaming vs canteen revenue, and discounts. The result prints as an 80mm
  **Z-report** (`/[locale]/shift-report/[id]`) with signature lines.
- **Shift history** (`/[locale]/pos/[loungeId]/shifts`, managers and owners): the last 60 shifts with cashier, times,
  takings, expenses, expected vs counted cash and variance, plus totals of short/over shifts; each row reprints its
  Z-report.

**Discounts** are entered at checkout as an amount or a percentage (5–50% presets) and applied before tax. They're
audited and show on the receipt and the shift report. A discount can't push the total below what was already paid.

**Walk-in canteen sales** use a side panel docked beside the device grid (it overlays the grid on tablets): tap items,
split payment, print a receipt. The menu includes a **hookah** category.

**Device management** (`/[locale]/pos/[loungeId]/devices`, managers and owners; linked from the POS top bar and the
dashboard):
- **Devices** grouped by category, showing status, effective Single / Multi / VIP rates, specs, IP/MAC and zone.
  Quick actions are Edit, Change status (Active / Maintenance / Out of order) and Delete.
- **Add / edit form:**
  - Basics: name/number, code (derived from the name if empty), category, zone, status.
  - Rates: optional per-device Single / Multi / VIP rates; empty means inherit the category.
  - Hardware: specs description, IP (IPv4/IPv6) and MAC (normalized), for future remote control and locking.
  - Floor-map position: automatic in the first free spot if left empty.
- **Delete:** a never-used device is deleted; one with history is **archived** so receipts and reports stay intact,
  and it can be **restored** (in maintenance). Both are refused while a session is running or bookings are upcoming,
  and the confirmation dialog shows why.
- **Categories:** add or edit name, type, default Single / Multi / VIP hourly rates, max players, minimum booking,
  start-time interval, and active flag. Only empty categories can be deleted; deactivate the others.
- **Pricing:** a device's rate overrides its category's everywhere: POS start, extend, tier change,
  transfer and live bills. Time-of-day rules still apply on top. Changing a rate while an open session is running bills
  the time so far at the old rate and the rest at the new one.

**Canteen menu management** (`/[locale]/pos/[loungeId]/menu`, managers and owners; linked from the POS top bar,
Device Management and the dashboard):
- **Sections** (`MenuCategory`): each lounge defines its own, e.g. "مشروبات باردة / Cold drinks", with Arabic and
  English names, a broad type (drink, snack, meal, dessert, hookah, other) for icons and reports, and a position.
  Only empty sections can be deleted.
- **Items:** search by name or SKU, filter tabs per section plus a *Low / out* tab. Each item shows name (Arabic and
  English), selling price, cost and margin, stock state (in stock / low / out / unlimited) and 30-day sales. Quick
  actions are Pause / Make available (staff may do this too), Adjust stock, Edit and Delete.
- **Add / edit form:**
  - Names: Arabic and optional English name, shown in the English UI.
  - Section: pick one, or create it inline.
  - Prices: selling price and cost, with a live margin.
  - Stock: a quantity or *unlimited* (e.g. fresh coffee), plus the low-stock threshold.
  - Display: an icon or image URL, SKU and description.
  - Availability toggle.
  - Saving is refused if POS sales changed the stock since the form was opened, so counts are never overwritten.
- **Adjust stock** adds deliveries or writes off damaged stock relative to the live count.
- **Delete:** a never-sold item is deleted; one with order history is **archived** (hidden from the POS, order lines kept for sales reports) and can be restored.
- **Live on the POS:** a database trigger announces menu changes, so price, availability, stock and new items show
  up on open POS screens immediately.

**Thermal receipts:** `/[locale]/receipt/[id]` (a session's booking id or a counter sale's order id) is an 80mm layout
(`@page { size: 80mm auto }`, 72mm printable). It is black on white, RTL in Arabic, and itemized with each payment
method, cash given and change. While a session is still running it prints as a *provisional bill*. The POS prints it
through a hidden iframe without leaving the screen; `?print=1` opens the print dialog on its own. Only staff of that
lounge can open a receipt.

## Realtime

```
Booking / Device / CanteenOrder / Shift / ShiftExpense / MenuItem / MenuCategory committed
  → src/server/db (commit)   adds a loungeEvents doc {loungeId, table, op, id, status, source} in the same transaction
  → src/server/realtime.ts   one Firestore listener per lounge with subscribers, fan-out in process
  → src/server/sse.ts        Server-Sent Events stream
  → useLiveEvents()          EventSource in the browser → debounced router.refresh()
```

- **Staff feed** `GET /api/manage/[loungeId]/events`: lounge members only. Carries the table, operation, row id and
  status.
- **Delivery:** events are written in the same transaction as the change, so rolled-back writes are never
  announced, and no-op updates are skipped. Every instance listens, so it works with several instances. Event docs
  carry an `expireAt` (1 day) with a TTL policy in `firestore.indexes.json`, so the collection stays small.
- **Reconnects:** the hub retries with backoff and tells clients to `resync` after reconnecting. EventSource reconnects
  on its own, and each stream closes after 10 minutes so auth is re-checked.
- **Fallback:** the board shows *Live*, *Connecting…* or *Polling*. Polling runs every 15 s while live updates are down
  and every 2 min as a safety net when they're up.
- **Hosting:** each open board holds one HTTP connection. Behind nginx, `X-Accel-Buffering: no` is already set. On
  serverless hosts (Netlify) a stream lasts at most as long as the function, then EventSource reconnects.

## Localization

```
src/i18n/
  config.ts              locales, default (ar), dir, intl locale, localePath()
  dictionaries/ar.ts     source of truth — its shape is the Dictionary type
  dictionaries/en.ts     typed as Dictionary, so missing/extra keys fail typecheck
  server.ts              getLocale() / getDictionary() for Server Components (via next/root-params)
  client.tsx             <I18nProvider> + useI18n() for Client Components
  format.ts              format("{n} …", vars), money(), formatTime(), formatDate() — all timezone-aware
```

**Add a language:** add the code to `locales` and `localeMeta` in `config.ts`, create `dictionaries/xx.ts` typed as
`Dictionary`, and register it in `server.ts`. `src/proxy.ts` redirects locale-less URLs using the `NEXT_LOCALE`
cookie (set by the language switcher), falling back to Arabic.

**RTL rules:** use logical classes (`ms-`, `pe-`, `start-`, `text-start`); shadcn is configured with `"rtl": true`.
The floor plan is always rendered `dir="ltr"` because a physical room must not be mirrored.

## Firebase

Firestore is the database. The server talks to it only through the Admin SDK (`src/lib/firebase-admin.ts`), after
the app's own permission checks; browsers never read Firestore directly.

| File | Side | What it gives you |
| --- | --- | --- |
| `src/server/db/` | server only | `db`: the data layer every query, service and action uses (see [Data layer](#data-layer)) |
| `src/lib/firebase-admin.ts` | server only | `getAdminApp()`, `getAdminAuth()` (async), `getAdminDb()`, `getAdminStorage()` from the service account, or the emulator |
| `src/lib/firebase.ts` | client | `getFirebaseApp()`, `getFirebaseAuth()`, `getDb()`, `getFirebaseStorage()` (optional; unused by the app) |
| `src/lib/firebase-storage.ts` | server only | `uploadProductImage(file, folderName): Promise<string>` |

Setup: create a project with Firestore (Native mode) and Storage. Under Project settings → Service accounts,
generate a private key and copy `project_id`, `client_email` and `private_key` into `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
`FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (one line, `\n` escapes, in double quotes). Then deploy the rules
and indexes (`npx firebase login`, `npx firebase use <project-id>`, `npm run firestore:deploy`) and seed if you want
the demo data (`npm run db:seed`).

**Security rules** (`firestore.rules`) only govern client-SDK access; the Admin SDK bypasses them. Users read and edit
their own profile but can't change their role, active flag, email or password hash; only super admins change roles.
Lounges, devices and menu items are publicly readable, everything not listed (transactions, wallets, accounts,
audit logs, ...) is denied.

**Menu photos.** With the Admin values and bucket set, the menu item form gets an "رفع صورة" (Upload image) button.
The file goes to a manager-only Server Action, is checked by content (JPEG/PNG/WebP/GIF, no SVG) and size (5 MB;
`serverActions.bodySizeLimit` is 6 MB), and is stored under `lounges/<loungeId>/menu/<random>.<ext>` with the Admin
SDK. The returned download-token URL is put in the item's image field. Uploads don't go straight from the browser:
the app signs people in with Auth.js, not Firebase Auth, so the bucket's rules can (and should) deny all client
access:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} { allow read, write: if false; }
  }
}
```

Token URLs keep working with these rules. `@grpc/grpc-js` is pinned to 1.14.6 via `overrides` (Firestore's own pin
has advisories).

## Sign-in (PIN only)

Everyone signs in at `/[locale]/pos/login`: pick your name on the branch's keypad and type your 4-6 digit PIN. Every
staff page sends signed-out visitors there and returns to it afterwards. There are no passwords and no Google sign-in.

- The keypad lists active members of the branch (the primary lounge) who have a PIN, plus super admins with one.
- `/api/auth/pos-pin` checks the PIN and hands a one-minute signed ticket to the Auth.js `pos-pin` credentials provider,
  which re-checks access to the branch; the session carries the role and the branch.
- Wrong PINs add up per account: every fifth locks PIN sign-in, for a minute the first time and twice as long each
  time after, up to a day. A correct PIN or a new PIN resets the count. PINs like `1111` or `1234` are refused.

PINs are set by managers and owners on the staff screens (`/[locale]/manage/<loungeId>/staff`, or POS → Staff), or with
`npm run staff:grant -- someone@example.com --pin 4821` (add `--role MANAGER` or `--role SUPER_ADMIN`). An account
without a PIN can't sign in, so give at least one admin a PIN with the CLI before relying on the keypad.

## Deploying (Netlify)

`netlify.toml` builds with `npm run build`, which needs no database or Firebase secrets.

1. Set up the Firebase project as in [Firebase](#firebase), including `npm run firestore:deploy`. A query whose
   composite index is missing fails with a Firestore error containing a link that creates it.
2. In Netlify → Site configuration → Environment variables set `AUTH_SECRET` (`NEXTAUTH_SECRET` also works), `NEXT_PUBLIC_APP_URL` (your site URL),
   `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, plus the storage bucket you use,
   and `POS_TERMINAL_CODE` (see [Branch code](#branch-code-recommended-on-a-public-url)).
3. Give an admin a PIN against the production Firestore (`npm run staff:grant -- you@example.com --role SUPER_ADMIN --pin <digits>`).

Don't run `db:seed` against a production project: it creates `player@gamelounge.dev` as a super admin with a published
PIN.

## Layout

```
scripts/                   seed-firestore.ts (demo data), firestore-indexes.mjs (index file from logged queries)
firestore.rules           client-access rules; firebase.json, firestore.indexes.json
src/proxy.ts               locale redirect
src/auth.ts                Auth.js config (PIN credentials only, JWT sessions with role and branch)
src/app/[locale]/          root layout (lang/dir), (pos), (manager), (print)
src/app/api/               auth handlers (PIN), live event stream (SSE)
src/components/            ui/ (shadcn), site/, auth/, pos/ (cashier terminal), manage/ (dashboard), devices/, menu/
src/lib/db/                model types and enums (types.ts), Decimal (shared with Client Components)
src/lib/booking/           pure, unit-tested: time.ts, schedule.ts (hours, slots, business day), pricing.ts, totals.ts
src/server/                db/ (Firestore data layer), queries/, services/ (pos.ts, shift.ts, booking.ts), actions/,
                           session.ts, staff.ts, realtime.ts (Firestore listener hub), sse.ts
src/hooks/                 use-live-events.ts (EventSource + debounced refresh)
```

## Data model notes

- **Tenancy:** `Organization` (tenant, commission rate, subscriptions, payouts) → `Lounge` → devices, menu, bookings.
  The platform role is `User.role`; per-lounge access is `LoungeMember` (OWNER / MANAGER / STAFF).
- **A session is a `Booking`.** Walk-ins use `source = WALK_IN`. "Extend +1hr" writes a `BookingExtension`.
- **No double booking:** the data layer rejects overlapping `PENDING | CONFIRMED | ACTIVE` bookings on the same
  device at commit, holding a per-device lock document so concurrent transactions serialize. Ranges are half-open, so
  back-to-back slots are allowed. The service maps the violation to a friendly "slot just taken" error.
- **Opening hours** that close at or before they open run past midnight; after-midnight slots belong to the
  previous business day.
- **Pricing:** `DeviceCategory.baseHourlyRate`, overridden per 5-minute step by the highest-priority matching
  `PricingRule` (fixed `hourlyRate` or `multiplierBps`). Prices are snapshotted onto the booking.
- **Money** is stored as a number with at most two decimals, read back as `Decimal`, and handled as integer minor
  units in code. Rates and commissions are basis points.

## Data layer

`src/server/db` is a small typed client over the Firebase Admin SDK with the call shapes the services were written
against: `db.booking.findMany({ where, include, select, orderBy, take })`, `create`, `update`, `updateMany`,
`deleteMany`, `count`, `aggregate`, `groupBy`, and `db.$transaction(async (tx) => ...)`.

- **Collections:** `users`, `lounges`, `devices`, `bookings`, `menuItems`, `shifts`, plus `deviceCategories`,
  `pricingRules`, `sessionSegments`, `bookingExtensions`, `canteenOrders`, `canteenOrderItems`, `menuCategories`,
  `transactions`, `wallets`, `shiftExpenses`, `organizations`, `subscriptions`, `loungeMembers`, `openingHours`,
  `floorZones`, `loungePhotos`, `payouts`, `auditLogs`, `accounts` (Auth.js), and `loungeEvents` (realtime). Model
  fields, defaults, relations and unique keys are in `src/lib/db/types.ts` and `src/server/db/schema.ts`.
- **Transactions** buffer their writes until commit, so code can read after it writes and sees its own changes.
  Commit enforces what Postgres used to: unique keys (claimed as `_uniques` documents), one open shift per lounge,
  one running segment per session, check constraints, the booking overlap rule, and foreign-key style deletes
  (cascade / set null / refuse). Concurrent transactions on the same key retry or fail like the SQL versions did.
- **Queries** push equality, `in` and range filters down to Firestore and evaluate the rest (OR, `not`, relation
  filters, case-insensitive matches) in memory. Composite indexes are listed in `firestore.indexes.json`; run with
  `FIRESTORE_INDEX_LOG=<file>` to log the indexes new queries need and `node scripts/firestore-indexes.mjs <file>` to
  merge them.
