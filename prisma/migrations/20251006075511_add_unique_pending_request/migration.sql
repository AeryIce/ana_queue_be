-- Satu email hanya boleh punya 1 PENDING per event
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pending_request_per_event_email"
ON "RegistrationRequest" ("eventId","email")
WHERE "status" = 'PENDING';
