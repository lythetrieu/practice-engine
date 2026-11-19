# Data, roles and the admin area

What the engine stores, who can see it, how to run the small admin area, and how to export or delete data. The
source of truth is the code: the tables are in `migrations/`, the server code is in `src/lib/server/` and
`src/pages/api/`. If you change what the code collects, change this page and the privacy notice (`/privacy/`).

- [Tables](#tables)
- [What the app sends, and when](#what-the-app-sends-and-when)
- [Roles](#roles)
- [Becoming an admin](#becoming-an-admin)
- [The admin pages](#the-admin-pages)
- [How long data is kept](#how-long-data-is-kept)
- [Export and delete data with wrangler](#export-and-delete-data-with-wrangler)
- [The privacy notice and the terms](#the-privacy-notice-and-the-terms)

## Tables

Cloudflare D1 (binding `DB`). Times are ISO 8601 UTC text. A child's learner ID is a random 16-character code that is
never shown or put in a URL; everything saved under it is deleted with it (`ON DELETE CASCADE`).

### Accounts and sign-in (`0001_init.sql`)

| Table | What it stores |
| --- | --- |
| `users` | One row per parent: lowercase `email`, `consent_at` (when they confirmed they are a parent or guardian), `created_at`, `seen_at`. |
| `children` | A child of a parent: `nickname` (24 characters at most), optional `grade`, a `username` and a `password_hash` (keyed PBKDF2, never the password), sign-in counters (`login_version`, `login_fails`, `locked_until`), and the `learner_id` the practice records are filed under. No email, no full name. |
| `sessions` | A signed-in parent's session: the SHA-256 of the cookie token, created/expires/seen times. 60 days, renewed on use. `created_at` is also the clock for "a fresh session". |
| `student_sessions` | A child signed in on a device: SHA-256 of the token, `login_version`, times. 120 days. |
| `student_links` | A one-time "scan to sign in" link: SHA-256 of the token, 15 minutes, single use. |
| `login_codes` | The pending 6-digit code per mailbox: an HMAC of it (not the code), tries, send counts. 10 minutes, 5 tries. |
| `pending_signups` | A proven email with no account yet, until the parent confirms. 15 minutes. |
| `erased_learners` | The SHA-256 of a deleted child's learner ID, for 400 days, so a device that still holds the ID cannot bring the data back (uploads under it answer 410). |
| `meta` | Small settings and counters: the daily write caps (`cap_<name>_<day>`), the sign-in email count (`mail_codes_<day>`), owner-alert timers (`alert:<kind>`) and the last cleanup result (`retention_last`). |

### Learners and practice data (`0001_init.sql`)

| Table | What it stores |
| --- | --- |
| `learners` | One row per learner ID: a child of a parent account, or an anonymous browser that sent a problem report or an app error. `created_at`, `last_seen_at` (moved at most once a day). |
| `app_progress` | One JSON document per learner: the practice app's progress (lessons, scores, finished full tests, points, days practiced, review list, settings, goal). `rev` goes up on every save. |
| `item_answers` | The answer log, one row per answer: `item_id` (the pack's question id), `rev`, `ctx` (lesson, check, placement, skill, practice, fix, review, test), `form_id`, `correct` (1/0), `hints`, `ms` (time on the question), `pick` (the choice index on multiple choice), `at`. Ids and numbers only. |
| `test_sessions` | One row per finished full test: the question ids in order, started/finished, and `scores` as `{"<section>": [right, total]}`. |
| `reports` | A problem report: `item_id` (the question id, or `app`), `item_rev`, `context` (`app` for a question, `issue` for the app itself), a `reason` from a fixed list, `meta` (JSON, whitelisted technical context), `created_at`, and `learner_id`. No free text. |
| `app_errors` | A crash or script error the app sent: `kind`, `message` (300 characters at most, emails and long numbers removed), `stack` (file paths), `screen`, `device`, `w`/`h`, `ver`, `browser` (family and major version), `seen` (a repeat within 10 minutes counts up), times, `learner_id`. |

### The optional AI tutor (`0002_ai_tutor.sql`)

Empty unless the site turns the tutor on (`docs/pip.md`).

| Table | What it stores |
| --- | --- |
| `ai_tutor_log` | One row per tutor button a child taps: question id, kind of help, model, whether it worked, time and token counts, and the model's reply. Never anything a child typed. |
| `tutor_feedback` | The "Does that make sense?" answer: question id, whether it was about the pack's explanation or the tutor's reply, and a yes/no. |

### Admin (`0003_admin.sql`)

| Change | What it does |
| --- | --- |
| `reports.resolved_at` | `NULL` means open. Resolving sets the time; reopening sets it back to `NULL`. No admin identity is stored. An index on `(resolved_at, created_at)` serves the Reports page. |

### The optional paid plan (`0004_paid_plan.sql`)

Empty unless the site turns payments on (`docs/payments.md`).

| Table or column | What it stores |
| --- | --- |
| `purchases` | One row per Polar order: the child it is for (`child_id`), the parent (`user_id`), `status` (paid, refunded), amount and currency, the buyer's email at Polar, Polar's checkout and customer ids, `ends_at`, and when each of the three plan emails went out. Kept for accounting; deleting the account sets `user_id` and `email` to NULL. |
| `plan_checkouts` | Each Polar checkout this site opened (parent, child, Polar's page, when it closes). Deleted 30 days after it closed. |
| `webhook_events` | Polar webhook ids already handled, so a redelivery changes nothing. Deleted after 90 days. |
| `children.plan_asked_at`, `plan_asked_kind` | The child's last "Ask a parent for more" and what for (lessons or tests). |

### Parent passwords (`0005_parent_password.sql`)

| Column | What it stores |
| --- | --- |
| `users.password_hash`, `password_at` | An optional password the parent added: a keyed PBKDF2 hash (never the password), and when it was set. |
| `users.pw_fails`, `pw_locked_until` | Wrong passwords in a row; 10 pause password sign-in for that account for 15 minutes (the emailed code still works). |

### What is never stored

A child's email, full name, phone or any free text; IP addresses (the code uses the IP only as a rate-limit key, and
Turnstile receives it when the bot check is on); a readable parent or child password or sign-in code (only keyed hashes);
card or bank details (Polar takes payments on its own page).

## What the app sends, and when

All of it goes to this site's own Worker (`src/pages/api/`). Nothing goes to analytics or ad services.

| What | When | Where it goes |
| --- | --- | --- |
| **Progress** (the progress JSON) | When the app opens (pull, merge, push), about 4 seconds after any change, and when the page is hidden or closed. Two devices merge: the better result of each lesson wins. | `POST /api/me/app-progress/` → `app_progress` |
| **Answer log** | Each answer waits in a small outbox on the device and goes up in batches of up to 200, a few seconds later (and again when the browser is back online). Finished full tests go with it. Capped per learner and per site per day. | `POST /api/me/answers/` → `item_answers`, `test_sessions` |
| **Problem report** | Only when a student taps the flag on a question or "report a problem" and picks a reason. Reason from a list, no typed text. Behind the bot check when it is on. Queued offline. | `POST /api/report/` → `reports` |
| **App error** | When the app crashes or throws; at most 5 different errors per page load. Repeats within 10 minutes count up. | `POST /api/app-error/` → `app_errors` |
| **Ask a parent for more** (only when payments are on) | When a child at a free limit taps the button. Only the kind (lessons or tests); the parent gets one email a day at most. | `POST /api/student/ask-parent/` → `children.plan_asked_at` |
| **AI tutor ask** (only when the tutor is on) | When a child taps a tutor button after a question. The question text goes to OpenRouter; the reply is logged. | `POST /api/me/tutor/` → `ai_tutor_log` |

On the device the app keeps a working copy of the progress, the unsent answer outbox, the language and a few settings in
`localStorage`, and a service worker caches the app files for offline use.

## Roles

| Role | How they sign in | What they can see and do |
| --- | --- | --- |
| **Parent** | An email address and a 6-digit code, or an email and a password if they added one on `/account/` (the code always works too). A new parent also confirms, with a checkbox, that they are a parent or guardian, 18 or older. | Their own account at `/account/`: add up to 3 children, make or reset a child's login, show a "scan to sign in" code, see each child's practice summary, remove a child, delete the account. Changes need a fresh session (a sign-in or a new emailed code in the last 15 minutes). A parent can also practice as a child they pick. |
| **Student** | The username and password the parent made, or a one-time link. | Only their own practice at `/app/` and their own view at `/account/`. No other child, no parent data. |
| **Admin** | A parent account whose email is in `ADMIN_EMAILS`. | Everything a parent can do, plus `/admin/`: aggregate counts, problem reports, app errors and question statistics. No names and no email addresses are shown on the admin pages. Resolving a report needs a fresh session. |

Anyone who is not an admin, signed in or not, gets the site's normal 404 page from `/admin/` and a plain 404 from
`/api/admin/`, so the admin area does not show itself.

## Becoming an admin

1. Put your own email in `ADMIN_EMAILS` (comma-separated, case does not matter). The variable is declared in
   `wrangler.jsonc` (`vars`) and is empty by default, which means nobody is an admin.
   - On Cloudflare: set it in `wrangler.jsonc` and deploy, or in the dashboard under the Worker's Variables.
   - Locally: add `ADMIN_EMAILS=you@example.com` to `.dev.vars` (that file is ignored by git) and let `npm run dev` pick
     it up. Keep it empty in anything you commit.
2. Sign in at `/account/` with that email, the normal way. There is no separate admin password: the admin is a parent
   account.
3. Open `/admin/`.

The list is read on every request, so removing an email takes effect at once for new requests. An email in the list
that has no account yet becomes an admin as soon as that person makes the account.

## The admin pages

All pages are server-rendered, never cached (`Cache-Control: no-store`), sent with `X-Robots-Tag: noindex`, and kept out
of the sitemap (`astro.config.mjs` `NOT_IN_SITEMAP` lists `/admin/`; check `dist/client/sitemap-0.xml` after a build).
They use the site layout and the pack's brand colors, and work on a phone. The code is in `src/lib/server/admin.ts` and
`src/pages/admin/`.

### Overview, `/admin/`

Counts: parent accounts, children, children who practiced in the last 7 and 30 days (their learner row was touched), answers
logged (all, and the last 7 days), open reports, and app errors in the last 7 days (times seen, and how many different
messages). Links to the other pages.

### Reports, `/admin/reports/`

Problem reports, newest first, filtered Open (default), Resolved or All. Each shows the reason, the time, and the
technical context the app sent (lesson, question number, the choice picked, device, browser, app version). For a
question report it also shows the question from the pack (its prompt, section, skill and difficulty, and the marked
answer for multiple choice) and how many reports that question has. **Mark resolved** and **Reopen** work on one report;
**Resolve all N on this question** closes every open report on a question at once. The learner who sent a report is
never selected or shown.

If your last sign-in was more than 15 minutes ago, the page asks you to confirm with an emailed code before it changes
anything, then repeats the change.

### Errors, `/admin/errors/`

App errors for the last 24 hours, 7 days (default) or 30 days, grouped by message: how many times, the last and first time,
the screens, the browsers and devices, the app versions, and the latest stack (file paths).

### Questions, `/admin/questions/`

One row per question of the pack, from the answer log over the last 30, 90 (default) or 365 days: tries, % right, the
average hints used, the most-picked wrong choice (multiple choice) with its share of tries and the key, the section, skill
and the pack's difficulty. Filter by section, flag and "answered / never answered"; sort by flags, section and skill,
% right, tries, hints or difficulty (click a column heading to flip the order). Questions the log has answered but the pack
no longer has are listed as "not in this pack". Only counts are shown, never who answered.

**How to read the flags.** A flag needs at least **30 tries**, because a few answers say nothing.

| Flag | Rule | What to do |
| --- | --- | --- |
| **Too easy** | 95% right or more | It may not teach anything. Make it harder, or leave it as a warm-up. |
| **Too hard** | 25% right or less | Check the wording and the key; the question may be unfair for its difficulty setting. |
| **Check this** | A wrong choice was picked more often than the right one | Look at the answer key first. This is the strongest sign of a wrong key or a misleading question. |

A question can have more than one flag. The thresholds are constants in `src/lib/server/admin.ts` (`MIN_TRIES`,
`EASY_AT`, `HARD_AT`).

**Cost.** D1 bills rows read. The overview counts rows in the answer log; the Questions page reads one time window, not
the whole log, so a year of answers is not scanned on every visit. Use the 30-day window on a large site.

## How long data is kept

A daily job (cron `17 8 * * *`, `src/worker.ts`) runs `src/lib/server/retention.ts`:

| Data | Kept |
| --- | --- |
| Answer log (`item_answers`), finished-test rows (`test_sessions`) | 12 months |
| Problem reports (`reports`), open or resolved, from anonymous browsers and from children | 12 months |
| AI tutor log and feedback | 12 months |
| App errors (`app_errors`) | 30 days |
| Anonymous browser IDs not seen for 12 months (with everything under them) | 12 months |
| A child's profile and progress | While the account is used; deleted at once when removed |
| An account unused for 24 months (no parent sign-in, no child signed in or practicing) | 24 months, deleted with its children |
| Expired sessions, sign-in codes, pending sign-ups, sign-in links, old daily counters | Cleared daily |
| `erased_learners` tombstones | 400 days |

Each run deletes in chunks inside the Worker's query budget and leaves the rest for the next day; the result is in
`meta.retention_last`. The report cleanup was widened for the admin area: `reports_children` deletes any report older than
12 months, where the older step only covered anonymous browsers. Cloudflare may keep database backups for a short period of its
own, so a deleted row can stay in a backup until it ages out.

## Export and delete data with wrangler

Run these from the project folder. **`--local` reads and changes the local development database. `--remote` reads and
changes your live database: check the command twice before you run it, and take an export first.** Both examples use the
binding name `DB` from `wrangler.jsonc`. In SQL, replace `<email>`, `<learner id>` and the dates with real values.

**Prefer the app for deleting.** A parent can remove a child or delete the account at `/account/`. That erases everything
in one step and also writes the tombstone in `erased_learners` that stops an old device from recreating the child. SQL
cannot compute that tombstone (it is a SHA-256 of the learner ID), so a delete by hand is for cases the app cannot
reach, such as a parent who has lost access and asks you by email.

### Export

```bash
# Local: one parent and their children (no password hashes)
npx wrangler d1 execute DB --local --json --command \
  "SELECT u.email, u.consent_at, u.created_at, c.id AS child_id, c.nickname, c.grade, c.username, c.learner_id
   FROM users u LEFT JOIN children c ON c.user_id = u.id WHERE u.email = '<email>'"

# REMOTE (live data): everything saved under one learner ID, to files
npx wrangler d1 execute DB --remote --json --command "SELECT data, rev, updated_at FROM app_progress WHERE learner_id = '<learner id>'" > progress.json
npx wrangler d1 execute DB --remote --json --command "SELECT * FROM item_answers WHERE learner_id = '<learner id>'" > answers.json
npx wrangler d1 execute DB --remote --json --command "SELECT * FROM test_sessions WHERE learner_id = '<learner id>'" > tests.json
npx wrangler d1 execute DB --remote --json --command "SELECT * FROM reports WHERE learner_id = '<learner id>'" > reports.json
```

The whole database can also be dumped with `npx wrangler d1 export DB --remote --output backup.sql` (add `--local` for
the local copy). Treat that file as personal data: it holds parent emails.

### Delete

```bash
# Local: one child's data, in the order the app uses (children and sessions go with the learner row)
npx wrangler d1 execute DB --local --command \
  "DELETE FROM item_answers WHERE learner_id = '<learner id>';
   DELETE FROM test_sessions WHERE learner_id = '<learner id>';
   DELETE FROM app_progress WHERE learner_id = '<learner id>';
   DELETE FROM reports WHERE learner_id = '<learner id>';
   DELETE FROM app_errors WHERE learner_id = '<learner id>';
   DELETE FROM learners WHERE id = '<learner id>';"

# REMOTE (live data, cannot be undone): a whole parent account and everything under it
npx wrangler d1 execute DB --remote --command \
  "DELETE FROM item_answers WHERE learner_id IN (SELECT c.learner_id FROM children c JOIN users u ON u.id = c.user_id WHERE u.email = '<email>');
   DELETE FROM test_sessions WHERE learner_id IN (SELECT c.learner_id FROM children c JOIN users u ON u.id = c.user_id WHERE u.email = '<email>');
   DELETE FROM app_progress WHERE learner_id IN (SELECT c.learner_id FROM children c JOIN users u ON u.id = c.user_id WHERE u.email = '<email>');
   DELETE FROM reports WHERE learner_id IN (SELECT c.learner_id FROM children c JOIN users u ON u.id = c.user_id WHERE u.email = '<email>');
   DELETE FROM app_errors WHERE learner_id IN (SELECT c.learner_id FROM children c JOIN users u ON u.id = c.user_id WHERE u.email = '<email>');
   DELETE FROM learners WHERE id IN (SELECT c.learner_id FROM children c JOIN users u ON u.id = c.user_id WHERE u.email = '<email>');
   DELETE FROM users WHERE email = '<email>';"
```

Deleting the `learners` row cascades to the child's `children` row and with it the child's sessions and links.
If the AI tutor was on, also delete that learner's rows from `ai_tutor_log` and `tutor_feedback` (their column is named
`learner`). Deleting the `users` row cascades to the parent's sessions; also clear `login_codes` and `pending_signups`
for the email if you want it gone entirely.

```bash
# REMOTE: remove old rows by date (the daily job already does this; use it only to catch up)
npx wrangler d1 execute DB --remote --command "DELETE FROM item_answers WHERE at < '2025-10-01T00:00:00.000Z'"
```

## The privacy notice and the terms

`/privacy/` and `/terms/` are prerendered pages (`src/pages/privacy/`, `src/pages/terms/`), in the sitemap, linked from the
footer and from the parent consent step on `/account/`. They are **templates, not legal advice**: a starting point that
describes what this code does, filled in from the pack. Have a lawyer who knows your country and your audience read them
before you go live, and read them yourself against the code: they must say what the code does.

They take their facts from `legal` in `pack.yaml`:

```yaml
legal:
  operator: Your Company LLC
  contactEmail: privacy@yourdomain.com
  address: 1 Main Street, Your City, ST 00000   # optional
  governingLaw: the State of New York, USA       # optional, used by the terms
  effectiveDate: "2026-10-28"
```

They also use `name` and `exam`, `audience` (the grade question), `mascot.name`, `site.disclaimer` (the "not affiliated
with the exam maker" line) and `scoring.disclaimer` (score estimates). If the `legal` block is missing, both pages show
clear placeholders such as "[Your organization]" and a banner at the top: "This is a template. Fill in the legal block in
pack.yaml before you go live." The terms also show a banner when `governingLaw` is missing.

Things to decide before launch:

- **The AI tutor.** The notice describes it as optional ("if we turn on"). Delete that bullet if you will never turn it
  on, and keep it accurate if you do (what is sent, which provider, how long the replies are kept).
- **Promises the code does not keep for you.** The notice says you will tell parents about significant changes, will answer
  privacy questions, and will send a copy of a family's data on request. There is no screen for those: you do them by
  email, with the export commands above.
- **Parental consent.** The notice describes what the code does: an emailed code proves the parent controls the address, a
  checkbox confirms they are a parent or guardian, 18 or older, and agrees. Whether that is enough for COPPA or your own
  law is a question for your lawyer.
- **Children's ages and other countries.** The templates are written for a US audience. If you serve children in the EU,
  the UK or elsewhere, other rules apply.
- **Hosting.** The notice names Cloudflare as host, database, email sender and optional bot check. Update it if you change
  that.
