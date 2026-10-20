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

## Google sign-in

Create an OAuth client (Web) in Google Cloud Console with redirect URI
`http://localhost:3000/api/auth/callback/google` (plus your production URL), then set `AUTH_GOOGLE_ID` and
`AUTH_GOOGLE_SECRET`. The Google button appears only when both are set. An email already registered with a password
is not auto-linked to Google, which is Auth.js's safe default.

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
