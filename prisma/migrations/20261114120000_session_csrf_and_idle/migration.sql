-- Forward-only: existing sessions keep their rows. lastSeenAt is backfilled by
-- the default; csrfHash stays NULL so those sessions can adopt a bound token on
-- their first state-changing request instead of being invalidated.
ALTER TABLE "sessions"
  ADD COLUMN "csrfHash" CHAR(64),
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
