-- The optional paid plan, sold through Polar (docs/payments.md, src/lib/server/polar.ts). Empty tables until the site
-- sets the POLAR_* settings and a `plan` block in pack.yaml.
--
-- One purchase is one child's plan for N months (pack.yaml plan.months), one payment that never renews.
-- - child_id has no foreign key, on purpose: removing a child deletes its children row, and its purchases keep the
--   old child_id, which then matches no child and gives nothing. The row stays for accounting.
-- - user_id is unlinked (and email cleared) when the parent deletes the account.
-- - paid_mailed_at / refund_mailed_at / ending_mailed_at: each purchase sends at most one "plan is on", one refund and
--   one "plan ends soon" email. The column is claimed before sending (src/lib/server/planMail.ts), so a webhook
--   redelivery, the thank-you screen racing the webhook, or a cron run twice never sends one twice.
CREATE TABLE purchases (
  id TEXT PRIMARY KEY,                 -- Polar's order id
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  child_id TEXT,                       -- the child the plan is for
  provider TEXT NOT NULL,              -- polar
  status TEXT NOT NULL,                -- paid | refunded
  amount INTEGER,                      -- in the currency's smallest unit (cents)
  currency TEXT,
  email TEXT,                          -- the buyer's email at Polar, for support; cleared with the account
  checkout_id TEXT,
  customer_ref TEXT,                   -- Polar's customer id, for the receipts portal
  ends_at TEXT NOT NULL,               -- the plan works until this time
  paid_mailed_at TEXT,
  refund_mailed_at TEXT,
  ending_mailed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX purchases_user ON purchases(user_id);
CREATE INDEX purchases_child ON purchases(child_id);
CREATE INDEX purchases_checkout ON purchases(checkout_id);
CREATE INDEX purchases_ending ON purchases(status, ends_at);

-- Polar webhooks already handled (the webhook-id header), so a redelivery changes nothing. Kept 90 days.
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- Every Polar checkout this site opened. A checkout for the same child is reused while it is open, so two tabs or a
-- double click lead to the same Polar page, which can be paid once; the thank-you screen only asks Polar about a
-- checkout listed here for that parent, so made-up ids cost no Polar request. Kept 30 days after the page closed.
CREATE TABLE plan_checkouts (
  id TEXT PRIMARY KEY,                 -- Polar's checkout id
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL,
  url TEXT NOT NULL,                   -- Polar's hosted page
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX plan_checkouts_child ON plan_checkouts(user_id, child_id, expires_at);

-- "Ask a parent for more": the last time a child at a free limit asked, and for what (lessons | tests). The parent
-- gets at most one email a day per child and sees the note on the account page. No free text.
ALTER TABLE children ADD COLUMN plan_asked_at TEXT;
ALTER TABLE children ADD COLUMN plan_asked_kind TEXT;
