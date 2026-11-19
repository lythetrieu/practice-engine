-- The optional AI tutor (docs/pip.md; src/lib/server/aitutor.ts, POST /api/me/tutor). Applied with the rest, but nothing
-- is written here unless the owner switches the tutor on (PIP_ENABLED=1 and an OpenRouter key).
--
-- What is kept, and why:
--   - ai_tutor_log: one row per tutor button a child taps, successful or not. It holds the model's reply, never
--     anything a child typed (the child only taps buttons). It counts the per-learner daily limit and lets the owner
--     spot bad replies. The site-wide daily cap is a counter in `meta` (caps.ts, key cap_pip_asks_<day>).
--   - tutor_feedback: the "Does that make sense?" answer after the pack's explanation or after the tutor's reply.
--     Ids and a yes/no only.
-- Both are deleted with the learner (ON DELETE CASCADE, and explicitly in account.ts when a child is removed or the
-- account is deleted) and after 12 months (retention.ts). Times are ISO 8601 UTC; `day` is the UTC calendar day.

CREATE TABLE ai_tutor_log (
  id INTEGER PRIMARY KEY,
  learner TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  day TEXT NOT NULL,                   -- YYYY-MM-DD (UTC): the day the daily limit counts in
  item TEXT NOT NULL,                  -- the question or step id
  kind TEXT NOT NULL,                  -- why_wrong, why_right, another_way, simpler, hint
  model TEXT,                          -- the model that answered (the first one that did)
  ok INTEGER NOT NULL,                 -- 1 = a reply was given, 0 = every model failed or answered nothing
  ms INTEGER,                          -- time the model took
  tokens_in INTEGER,
  tokens_out INTEGER,
  reply TEXT
);
CREATE INDEX ai_tutor_log_learner_day ON ai_tutor_log(learner, day);
CREATE INDEX ai_tutor_log_at ON ai_tutor_log(at);

CREATE TABLE tutor_feedback (
  id INTEGER PRIMARY KEY,
  learner TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  day TEXT NOT NULL,                   -- YYYY-MM-DD (UTC)
  item TEXT NOT NULL,                  -- the question id
  about TEXT NOT NULL CHECK (about IN ('exp', 'pip')),   -- the pack's explanation, or the tutor's reply
  ask_id INTEGER,                      -- ai_tutor_log.id of the tutor's reply, when about = 'pip'
  sense INTEGER NOT NULL               -- 1 = makes sense, 0 = not yet
);
CREATE INDEX tutor_feedback_item ON tutor_feedback(item);
CREATE INDEX tutor_feedback_learner_day ON tutor_feedback(learner, day);
CREATE INDEX tutor_feedback_at ON tutor_feedback(at);
