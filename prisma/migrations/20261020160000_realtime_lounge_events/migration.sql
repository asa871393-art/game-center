-- Realtime: every change to a lounge's bookings, devices or canteen orders is
-- announced on the "lounge_events" channel. NOTIFY is transactional, so
-- listeners only hear about committed changes, and Postgres folds identical
-- payloads within one transaction. Hand-written: keep when squashing migrations.

CREATE OR REPLACE FUNCTION notify_lounge_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  payload jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rec := OLD;
  ELSE
    rec := NEW;
  END IF;

  -- Skip no-op updates (e.g. an UPDATE that rewrites the same values).
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;

  payload := jsonb_build_object(
    'loungeId', rec."loungeId",
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'id', rec.id,
    'status', rec.status::text
  );
  IF TG_TABLE_NAME = 'Booking' THEN
    payload := payload || jsonb_build_object('source', rec.source::text);
  END IF;

  PERFORM pg_notify('lounge_events', payload::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Booking_notify_lounge_event"
  AFTER INSERT OR UPDATE OR DELETE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION notify_lounge_event();

CREATE TRIGGER "Device_notify_lounge_event"
  AFTER INSERT OR UPDATE OR DELETE ON "Device"
  FOR EACH ROW EXECUTE FUNCTION notify_lounge_event();

CREATE TRIGGER "CanteenOrder_notify_lounge_event"
  AFTER INSERT OR UPDATE OR DELETE ON "CanteenOrder"
  FOR EACH ROW EXECUTE FUNCTION notify_lounge_event();
