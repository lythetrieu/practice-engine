-- An optional password for a parent account (src/lib/server/parentPassword.ts), next to the emailed code, never instead
-- of it: the code is also the way back in when the password is forgotten. Hashed like student passwords
-- (src/lib/server/password.ts: HMAC with PASSWORD_PEPPER, then PBKDF2).
-- pw_fails / pw_locked_until: wrong passwords in a row, and the 15-minute pause after 10 of them.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_at TEXT;
ALTER TABLE users ADD COLUMN pw_fails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pw_locked_until TEXT;
