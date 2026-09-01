-- Railway Hobby keeps the historical 9 GB migration immutable and lowers the active logical quota.
DO $$
DECLARE
  active_bytes bigint;
BEGIN
  SELECT used_bytes + reserved_bytes INTO active_bytes
  FROM file_store_counter WHERE singleton FOR UPDATE;
  IF active_bytes IS NULL THEN
    RAISE EXCEPTION 'file store counter is missing';
  END IF;
  IF active_bytes > 4000000000 THEN
    RAISE EXCEPTION 'active file bytes (%) exceed the Hobby quota', active_bytes;
  END IF;
END;
$$;

ALTER TABLE file_store_counter DROP CONSTRAINT file_store_counter_quota_bytes_check;
UPDATE file_store_counter SET quota_bytes = 4000000000 WHERE singleton;
ALTER TABLE file_store_counter
  ADD CONSTRAINT file_store_counter_quota_bytes_check CHECK (quota_bytes = 4000000000);
