-- Admin area (/admin/, src/lib/server/admin.ts): a problem report can be marked resolved.
-- NULL = open. The time is when an admin resolved it; reopening sets it back to NULL. No admin identity is stored.
-- Reports older than 12 months are deleted whether open or resolved (src/lib/server/retention.ts).
ALTER TABLE reports ADD COLUMN resolved_at TEXT;
CREATE INDEX reports_status ON reports(resolved_at, created_at);
