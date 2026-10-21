# Nexus Lounge — Gaming Lounge Booking & Management

Multi-tenant platform for gaming lounges (PC arenas, PlayStation, VR, VIP rooms):
customer booking, lounge POS/floor plan, and super-admin tenant management.
Arabic (RTL) is the default language; English is included.

**Stack:** Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind v4 · shadcn/ui (Base UI, RTL) ·
Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL 17 · Zustand · Auth.js v5 · Vitest

## Getting started

```bash
cp .env.example .env          # then set AUTH_SECRET (npx auth secret)
npm install
npm run db:up                 # Postgres in Docker on localhost:5433
npm run db:deploy             # apply migrations
npm run db:seed               # 3 lounges (Baghdad ×2, Erbil), menus, 4 users
npm run dev                   # http://localhost:3000 → redirects to /ar
```

Demo logins (password `Password123!`): `admin@`, `owner@`, `staff@`, `player@gamelounge.dev`.
`player@` is also a super admin, so it can manage every lounge's POS, devices and menu.

## Scripts

| Script | Purpose |
| --- | --- |
| `test` | Unit tests (pricing, timezones, opening hours, business day, bill totals, money) |
| `test:integration` | Booking, payment, POS and realtime (LISTEN/NOTIFY) against `TEST_DATABASE_URL` |
| `typecheck` / `lint` / `build` | Static checks and production build |
| `db:migrate` | Create + apply a migration from `schema.prisma` changes |
| `db:reset` | Drop, re-migrate and re-seed the local database |
| `db:studio` | Prisma Studio |

### Integration test database (one-time)

```bash
docker compose exec postgres psql -U gaming -d postgres -c "CREATE DATABASE gaming_lounge_test"
# PowerShell: $env:DATABASE_URL=...; bash: DATABASE_URL=... before each command
DATABASE_URL="postgresql://gaming:gaming@localhost:5433/gaming_lounge_test" npx prisma migrate deploy
DATABASE_URL="postgresql://gaming:gaming@localhost:5433/gaming_lounge_test" npx prisma db seed
npm run test:integration
```

The setup refuses to run if `TEST_DATABASE_URL` equals `DATABASE_URL`.

## Customer features (Phase 2)

- **Landing** (`/[locale]`): search by name, city and device type; device-type shortcuts; featured lounges.
- **Search** (`/[locale]/lounges?q=&city=&type=`).
- **Lounge page** (`/[locale]/lounges/[slug]`): interactive floor plan (map + list view), pricing, opening hours.
- **Booking dialog**: 14-day date strip → free start times for that device → duration and players →
  snacks/drinks pre-order → payment method and notes. The price preview uses the same pricing code as the server.
- **Checkout**: *Pay at the lounge* (confirmed immediately, unpaid) or *ZainCash / FastPay* (sandbox, see below).
- **Confirmation** (`/[locale]/bookings/[reference]`) and **My bookings** (`/[locale]/account/bookings`).
- **Auth**: email/password and Google (`/[locale]/login`, `/[locale]/register`).

## Lounge dashboard & POS (Phase 3)

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
- An open session holds its seat until the next booking or closing time, so online customers can't book that device
  meanwhile. At checkout the hold shrinks to the actual end.
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
audited and show on the receipt and the shift report. A discount can't push the total below what was already paid
online.

**Walk-in canteen sales** use a side panel docked beside the device grid (it overlays the grid on tablets): tap items,
split payment, print a receipt. The menu includes a **hookah** category.

**Device management** (`/[locale]/pos/[loungeId]/devices`, managers and owners; linked from the POS top bar, the
dashboard and `/admin`):
- **Devices** grouped by category, showing status, effective Single / Multi / VIP rates, specs, IP/MAC and zone.
  Quick actions are Edit, Change status (Active / Maintenance / Out of order) and Delete.
- **Add / edit form:**
  - Basics: name/number, code (derived from the name if empty), category, zone, status, bookable online.
  - Rates: optional per-device Single / Multi / VIP rates; empty means inherit the category.
  - Hardware: specs description, IP (IPv4/IPv6) and MAC (normalized), for future remote control and locking.
  - Floor-map position: automatic in the first free spot if left empty.
- **Delete:** a never-used device is deleted; one with history is **archived** so receipts and reports stay intact,
  and it can be **restored** (in maintenance). Both are refused while a session is running or bookings are upcoming,
  and the confirmation dialog shows why.
- **Categories:** add or edit name, type, default Single / Multi / VIP hourly rates, max players, minimum booking,
  start-time interval, and active flag. Only empty categories can be deleted; deactivate the others.
- **Pricing:** a device's rate overrides its category's everywhere: online booking, POS start, extend, tier change,
  transfer and live bills. Time-of-day rules still apply on top. Changing a rate while an open session is running bills
  the time so far at the old rate and the rest at the new one.

**Canteen menu management** (`/[locale]/pos/[loungeId]/menu`, managers and owners; linked from the POS top bar,
Device Management, the dashboard and `/admin`):
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
- **Delete:** a never-sold item is deleted; one with order history is **archived** (hidden from the POS and booking
  site, order lines kept for sales reports) and can be restored.
- **Live on the POS:** a database trigger announces menu changes, so price, availability, stock and new items show
  up on open POS screens immediately.

**Thermal receipts:** `/[locale]/receipt/[id]` (a session's booking id or a counter sale's order id) is an 80mm layout
(`@page { size: 80mm auto }`, 72mm printable). It is black on white, RTL in Arabic, and itemized with each payment
method, cash given and change. While a session is still running it prints as a *provisional bill*. The POS prints it
through a hidden iframe without leaving the screen; `?print=1` opens the print dialog on its own. Only staff of that
lounge can open a receipt.

## Realtime (Phase 4)

```
Booking / Device / CanteenOrder row committed
  → Postgres trigger  pg_notify('lounge_events', {loungeId, table, op, id, status, source})
  → src/server/realtime.ts   one LISTEN connection per server process, fan-out by lounge
  → src/server/sse.ts        Server-Sent Events stream
  → useLiveEvents()          EventSource in the browser → debounced router.refresh()
```

- **Staff feed** `GET /api/manage/[loungeId]/events`: lounge members only. Carries the table, operation, row id and
  status, and shows a toast when an online booking arrives.
- **Public feed** `GET /api/lounges/[slug]/events`: carries only `{scope: "availability"}`, never booking details. The
  lounge page uses it to refresh device statuses and the open booking dialog's free slots.
- **Delivery:** NOTIFY is transactional, so rolled-back writes are never announced and identical events in one
  transaction are merged. Every process LISTENs, so it works with several instances.
- **Reconnects:** the hub retries with backoff and tells clients to `resync` after reconnecting. EventSource reconnects
  on its own, and each stream closes after 10 minutes so auth is re-checked.
- **Fallback:** the board shows *Live*, *Connecting…* or *Polling*. Polling runs every 15 s while live updates are down
  and every 2 min as a safety net when they're up.
- **Hosting:** each open board holds one HTTP connection. Behind nginx, `X-Accel-Buffering: no` is already set. The
  trigger lives in `prisma/migrations/20261020160000_realtime_lounge_events`; keep it if you squash migrations.

## Platform admin

`/[locale]/admin` (super admins only, checked against the database) covers the last 30 days per organization and lounge:
revenue (payments minus refunds), online payments, platform commission (online payments × the organization's rate),
bookings, live sessions, devices and subscription. Each lounge can be **suspended** or **reactivated**, which is
audited. A suspended lounge drops out of search and stops taking online bookings, and its staff board keeps working.

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

## Payments

`src/server/payments/` defines a `PaymentProvider` interface. With `PAYMENTS_MODE=mock` (the default), ZainCash and
FastPay use an in-app **sandbox gateway** (`/[locale]/checkout/[transactionId]`) where you simulate approval or decline.
No real money is involved, and the UI labels these methods as sandbox.

Online bookings are created `PENDING` with a slot hold (`PAYMENT_HOLD_MINUTES`, default 15).
- **approved** → `CONFIRMED`, `PAID`
- **declined** → `CANCELLED`, pre-order restocked, slot freed
- **expired** → released automatically the next time someone books that device. Pages already show it as cancelled.

Settlement is idempotent: only the first result for a pending transaction counts.

**Going live:** implement `PaymentProvider` for each wallet: create the payment with merchant credentials, return the
hosted URL, and verify the signed callback in a route handler before calling `settlePayment()`. Return it from
`getPaymentProvider()`. Set `PAYMENTS_MODE=disabled` to offer pay-at-lounge only.

## Firebase (optional)

Everything Firebase is optional: with the `.env` values empty the app runs as before.

| File | Side | What it gives you |
| --- | --- | --- |
| `src/lib/firebase.ts` | client | `getFirebaseApp()`, `getFirebaseAuth()`, `getDb()` (Firestore), `getFirebaseStorage()`; lazy, reuses the app across hot reloads |
| `src/lib/firebase-admin.ts` | server only | `getAdminApp()`, `getAdminAuth()`, `getAdminDb()`, `getAdminStorage()` from the service account |
| `src/lib/firebase-storage.ts` | server only | `uploadProductImage(file, folderName): Promise<string>` |

Setup: in the Firebase console, add a Web app and copy its config into the `NEXT_PUBLIC_FIREBASE_*` values; enable
Storage (that gives the bucket name); under Project settings → Service accounts, generate a private key and copy its
`client_email` and `private_key` into `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` (one line, `\n` escapes, in
double quotes). Restart `npm run dev`.

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

## Google sign-in

1. Google Cloud Console → APIs & Services → OAuth consent screen: set it up (External, add your test users while
   it is in "Testing").
2. Credentials → Create credentials → OAuth client ID → Web application. Authorized redirect URI:
   `http://localhost:3000/api/auth/callback/google` (plus `https://<your-domain>/api/auth/callback/google` in production).
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Auth.js's
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` names also work) and restart `npm run dev`.

"تسجيل الدخول باستخدام جوجل" then works on the login and register pages and at the booking checkout. In development
without keys, the login page shows the button disabled with a setup hint; in production it is hidden.

- A first Google sign-in creates a `User` with the default role `CUSTOMER`.
- If the email already has an account, Google is linked to it (only for Google-verified emails). When that account's
  email was never verified (self-registration doesn't verify), its password is removed on linking, so someone who
  registered another person's address can't keep access. Staff and owners keep their roles and passwords.

## Layout

```
prisma/                    schema, migrations (init has hand-written constraints at the bottom), seed
src/proxy.ts               locale redirect
src/auth.ts                Auth.js config (credentials + optional Google, JWT sessions with role)
src/app/[locale]/          root layout (lang/dir), (customer) pages, (manager), (admin)
src/app/api/               auth handlers, lounge availability, live event streams (SSE)
src/components/            ui/ (shadcn), site/, search/, lounge/, booking/, auth/, manage/ (POS board)
src/lib/booking/           pure, unit-tested: time.ts, schedule.ts (hours, slots, business day), pricing.ts, totals.ts
src/server/                queries/, services/ (booking.ts, pos.ts), actions/, payments/, session.ts, staff.ts,
                           realtime.ts (LISTEN hub), sse.ts
src/hooks/                 use-live-events.ts (EventSource + debounced refresh)
src/stores/                Zustand booking draft
```

## Data model notes

- **Tenancy:** `Organization` (tenant, commission rate, subscriptions, payouts) → `Lounge` → devices, menu, bookings.
  The platform role is `User.role`; per-lounge access is `LoungeMember` (OWNER / MANAGER / STAFF).
- **A session is a `Booking`.** Walk-ins use `source = WALK_IN`. "Extend +1hr" writes a `BookingExtension`.
- **No double booking:** a Postgres `EXCLUDE USING gist` constraint rejects overlapping
  `PENDING | CONFIRMED | ACTIVE` bookings on the same device. Ranges are half-open, so back-to-back slots are allowed.
  The service maps the violation to a friendly "slot just taken" error.
- **Opening hours** that close at or before they open run past midnight; after-midnight slots belong to the
  previous business day.
- **Pricing:** `DeviceCategory.baseHourlyRate`, overridden per 5-minute step by the highest-priority matching
  `PricingRule` (fixed `hourlyRate` or `multiplierBps`). Prices are snapshotted onto the booking.
- **Money** is `Decimal(12,2)` in the DB and integer minor units in code. Rates and commissions are basis points.
