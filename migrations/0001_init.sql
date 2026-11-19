-- Practice engine database (Cloudflare D1, binding DB in wrangler.jsonc).
-- Apply locally: npm run db:migrate:local. Apply to your own Cloudflare account: npm run db:migrate:remote.
--
-- What is kept, and why:
--   - Parents sign in with a 6-digit code sent to their email. There are no passwords for parents.
--   - A parent adds up to 3 children. A child is a nickname and an optional grade, nothing else. The parent
--     makes each child a username and a generated password; the child signs in on any device with it.
--   - A child's practice progress is saved under the child's random learner ID, so it follows the child
--     to every device and the parent can see a summary.
--   - Reports of a problem and app crashes carry fixed reasons and technical details only. Nothing a child
--     types is stored.
-- D1 bills every row and index entry written, so keep writes few. Times are ISO 8601 UTC text.
-- Code: src/lib/server/ (auth.ts, account.ts, student.ts, retention.ts) and src/pages/api/.

-- Small settings and daily counters (sign-in email cap, write caps, the last retention run).
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------- learners

-- One row per learner ID: a child of a parent account, or an anonymous browser that sent a report or an error.
-- Everything saved under an ID is deleted with its row (ON DELETE CASCADE).
CREATE TABLE learners (
  id TEXT PRIMARY KEY,                 -- 16 characters, Crockford base32 (80 random bits); never shown or put in a URL
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL           -- updated at most once a day (each update is a billed write)
);
CREATE INDEX learners_seen ON learners(last_seen_at);

-- ---------------------------------------------------------------- parents and children

CREATE TABLE users (
  id TEXT PRIMARY KEY,                 -- random
  email TEXT NOT NULL UNIQUE,          -- lowercase; the parent's
  consent_at TEXT NOT NULL,            -- when they confirmed they are a parent or guardian
  created_at TEXT NOT NULL,
  seen_at TEXT NOT NULL                -- last sign-in or use, moved at most once a day
);

CREATE TABLE children (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL UNIQUE REFERENCES learners(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,              -- up to 24 characters; a nickname, not a full name
  grade INTEGER,                       -- one of the pack's audience options, optional
  created_at TEXT NOT NULL,
  username TEXT,                       -- lowercase, unique; set by the parent
  password_hash TEXT,                  -- keyed PBKDF2 (src/lib/server/password.ts)
  login_version INTEGER NOT NULL DEFAULT 1,   -- bumped on a reset: signs the child out everywhere
  login_fails INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT                    -- after 10 wrong passwords in a row, 15 minutes
);
CREATE INDEX children_user ON children(user_id);
CREATE UNIQUE INDEX children_username ON children(username);

-- Signed-in parents. The cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,            -- also the clock for "a fresh session" (a sign-in or a re-confirmation)
  expires_at TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

-- One pending 6-digit code per mailbox: an HMAC of it, 10 minutes, 5 tries, at most 10 a day.
CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,              -- the mailbox key (lowercase, no +tag, Gmail without dots)
  code_hash TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sends INTEGER NOT NULL DEFAULT 1,
  day_start TEXT NOT NULL
);

-- A proven email with no account yet: the account is made only after the parent confirms they are a
-- parent or guardian. 15 minutes; the cookie holds the token.
CREATE TABLE pending_signups (
  id TEXT PRIMARY KEY,                 -- SHA-256 of the cookie token
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- A child signed in on a device (student login or "scan to sign in").
CREATE TABLE student_sessions (
  id TEXT PRIMARY KEY,                 -- SHA-256 of the cookie token
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  login_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
CREATE INDEX student_sessions_child ON student_sessions(child_id);
CREATE INDEX student_sessions_expires ON student_sessions(expires_at);

-- "Scan to sign in": a one-time link a parent shows as a QR code. 15 minutes, single use.
CREATE TABLE student_links (
  id TEXT PRIMARY KEY,                 -- SHA-256 of the link's token
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- A removed child's learner ID can still sit in a browser. A tombstone makes uploads under it answer 410,
-- so its rows never come back. Only the SHA-256 of the ID, kept 400 days (retention.ts).
CREATE TABLE erased_learners (
  id_hash TEXT PRIMARY KEY,
  erased_at TEXT NOT NULL
);

-- ---------------------------------------------------------------- practice data

-- The practice app's progress for one learner: the Progress JSON (src/practice/store.ts; it holds the finished
-- full tests too). `rev` goes up on every save, so two devices saving at once are noticed (the second one merges).
CREATE TABLE app_progress (
  learner_id TEXT PRIMARY KEY REFERENCES learners(id) ON DELETE CASCADE,
  data TEXT NOT NULL,                  -- Progress JSON
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Every answer a signed-in learner gives, one row each, so a pack author can see which questions are too easy,
-- too hard or never shown. Ids and numbers only; nothing a child types. Deleted after 12 months (retention.ts).
CREATE TABLE item_answers (
  id INTEGER PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,               -- the pack's question id
  rev INTEGER,
  ctx TEXT NOT NULL,                   -- lesson, check, placement, skill, practice, fix, review, test
  form_id TEXT,
  correct INTEGER NOT NULL,            -- 1 or 0
  hints INTEGER DEFAULT 0,
  ms INTEGER,                          -- time on the question in milliseconds, when known
  pick INTEGER,                        -- multiple choice: the index of the choice picked
  at TEXT NOT NULL
);
CREATE INDEX item_answers_item ON item_answers(item_id);
CREATE INDEX item_answers_learner ON item_answers(learner_id, at);
CREATE INDEX item_answers_at ON item_answers(at);

-- One row per finished full test.
CREATE TABLE test_sessions (
  id TEXT PRIMARY KEY,                 -- made by the app, so a retried upload is saved once
  learner_id TEXT REFERENCES learners(id) ON DELETE CASCADE,
  form_id TEXT,
  kind TEXT,
  items TEXT,                          -- JSON array of question ids, in the order shown
  started TEXT,
  finished TEXT,
  scores TEXT                          -- JSON {"<section id>": [right, total]}
);
CREATE INDEX test_sessions_learner ON test_sessions(learner_id, finished);
CREATE INDEX test_sessions_finished ON test_sessions(finished);

-- ---------------------------------------------------------------- problem reports and app errors

-- "Report a problem" on a question (context 'app') or on the app itself (context 'issue'). A reason from a
-- fixed list and a little technical context in `meta` (JSON); no free text.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  item_id TEXT NOT NULL,               -- the question id, or 'app'
  item_rev INTEGER,
  learner_id TEXT REFERENCES learners(id) ON DELETE CASCADE,
  context TEXT NOT NULL,               -- app, issue
  reason TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX reports_created ON reports(created_at);
CREATE INDEX reports_item ON reports(item_id);

-- Crashes and script errors the practice app sends on its own. One row per message per browser, counted for
-- 10 minutes (`seen` goes up instead of a new row). Technical details only. Deleted after 30 days.
CREATE TABLE app_errors (
  id INTEGER PRIMARY KEY,
  learner_id TEXT REFERENCES learners(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                  -- crash, error, promise
  message TEXT NOT NULL,               -- at most 300 characters
  stack TEXT,                          -- at most 1,500 characters, file paths only
  screen TEXT,
  device TEXT,                         -- phone, tablet, computer
  w INTEGER,
  h INTEGER,
  ver TEXT,                            -- app version
  browser TEXT,                        -- family and major version, e.g. "Safari 18 · iOS"
  seen INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_at TEXT NOT NULL
);
CREATE INDEX app_errors_time ON app_errors(created_at);
CREATE INDEX app_errors_message ON app_errors(message, last_at);
CREATE INDEX app_errors_learner ON app_errors(learner_id);
