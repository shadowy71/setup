-- Migration 027 installed capture before the club-request and storage tables
-- existed. Refresh its existing catalogue and triggers; no backup configuration,
-- credentials, worker, encryption, or existing contents are changed.
select public.backup_sync_triggers();
