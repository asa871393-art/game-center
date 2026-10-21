-- Menu management: lounge-defined menu categories, bilingual names, cost price,
-- low-stock threshold, icons, and archiving.

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" TEXT NOT NULL,
    "loungeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "kind" "MenuItemCategory" NOT NULL DEFAULT 'OTHER',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuCategory_loungeId_sortOrder_idx" ON "MenuCategory"("loungeId", "sortOrder");
CREATE UNIQUE INDEX "MenuCategory_loungeId_name_key" ON "MenuCategory"("loungeId", "name");
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_loungeId_fkey" FOREIGN KEY ("loungeId") REFERENCES "Lounge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (menuCategoryId starts nullable so existing rows can be backfilled)
ALTER TABLE "MenuItem" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "costPrice" DECIMAL(12,2),
ADD COLUMN     "iconName" TEXT,
ADD COLUMN     "lowStockAt" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "menuCategoryId" TEXT,
ADD COLUMN     "nameEn" TEXT;

-- Backfill: one menu category per lounge for each kind already in use, named like the old fixed sections.
INSERT INTO "MenuCategory" ("id", "loungeId", "name", "nameEn", "kind", "sortOrder", "updatedAt")
SELECT
  'mc_' || md5(used."loungeId" || used."category"::text),
  used."loungeId",
  CASE used."category"
    WHEN 'DRINK' THEN 'مشروبات' WHEN 'SNACK' THEN 'سناكات' WHEN 'MEAL' THEN 'وجبات'
    WHEN 'DESSERT' THEN 'حلويات' WHEN 'HOOKAH' THEN 'أراكيل' ELSE 'أخرى' END,
  CASE used."category"
    WHEN 'DRINK' THEN 'Drinks' WHEN 'SNACK' THEN 'Snacks' WHEN 'MEAL' THEN 'Meals'
    WHEN 'DESSERT' THEN 'Desserts' WHEN 'HOOKAH' THEN 'Hookah' ELSE 'Other' END,
  used."category",
  CASE used."category"
    WHEN 'DRINK' THEN 0 WHEN 'SNACK' THEN 1 WHEN 'MEAL' THEN 2
    WHEN 'DESSERT' THEN 3 WHEN 'HOOKAH' THEN 4 ELSE 5 END,
  CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "loungeId", "category" FROM "MenuItem") AS used;

UPDATE "MenuItem" SET "menuCategoryId" = 'mc_' || md5("loungeId" || "category"::text);

ALTER TABLE "MenuItem" ALTER COLUMN "menuCategoryId" SET NOT NULL;
CREATE INDEX "MenuItem_menuCategoryId_idx" ON "MenuItem"("menuCategoryId");
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_menuCategoryId_fkey" FOREIGN KEY ("menuCategoryId") REFERENCES "MenuCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Hand-written (keep when squashing migrations).
-- =============================================================================

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_cost_chk" CHECK ("costPrice" IS NULL OR "costPrice" >= 0),
  ADD CONSTRAINT "MenuItem_low_stock_chk" CHECK ("lowStockAt" >= 0);

-- Realtime: read status/source through jsonb so the same trigger works for
-- tables without those columns (menu items and categories).
CREATE OR REPLACE FUNCTION notify_lounge_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb;
  payload jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rec := to_jsonb(OLD);
  ELSE
    rec := to_jsonb(NEW);
  END IF;

  -- Skip no-op updates (e.g. an UPDATE that rewrites the same values).
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;

  payload := jsonb_build_object(
    'loungeId', rec->>'loungeId',
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'id', rec->>'id',
    'status', coalesce(rec->>'status', '')
  );
  IF rec ? 'source' THEN
    payload := payload || jsonb_build_object('source', rec->>'source');
  END IF;

  PERFORM pg_notify('lounge_events', payload::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "MenuItem_notify_lounge_event"
  AFTER INSERT OR UPDATE OR DELETE ON "MenuItem"
  FOR EACH ROW EXECUTE FUNCTION notify_lounge_event();

CREATE TRIGGER "MenuCategory_notify_lounge_event"
  AFTER INSERT OR UPDATE OR DELETE ON "MenuCategory"
  FOR EACH ROW EXECUTE FUNCTION notify_lounge_event();
