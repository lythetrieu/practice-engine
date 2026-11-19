# Payments (optional)

The engine can sell one paid plan through [Polar](https://polar.sh), a merchant of record: Polar sells to the parent,
takes the payment, handles sales tax and sends the receipt, then pays you. **It is off unless you turn it on.** Off
means no checkout, no price anywhere and no free limits: the app works as if this page did not exist.

- One plan per child, bought by the parent: one payment for `plan.months` months. It never renews.
- A child's screens never show a price or a payment. At a free limit, a child signed in with their own login can tap
  "Ask a parent for more", which emails the parent (once a day at most, no price in it).
- The parent buys on `/account/` ("Get Plus for Mia"), pays on Polar's page, and comes back to a thank-you screen in
  the app (`/app/#thanks`). Receipts and invoices open Polar's customer portal from `/account/`.
- Three emails, each sent once per purchase: the plan is on, a refund, and "ends in two weeks" (the daily cron).

The code: `src/lib/server/plan.ts` (rules), `src/lib/server/polar.ts` (Polar), `src/lib/server/planMail.ts` (emails),
`src/pages/api/plan/` (checkout, confirm, portal, webhook), `src/practice/limits.ts` (free limits in the app),
`migrations/0004_paid_plan.sql` (tables).

## Turn it on

1. **In `pack.yaml`**, add a `plan` block (all fields in [authoring-a-pack.md](authoring-a-pack.md#plan-optional)):

   ```yaml
   plan:
     name: Plus
     priceLabel: "$49"
     months: 12
     refundDays: 14
     limits: { freeDays: 7, newLessonsPerDay: 2, fullTests: 1 }
   ```

2. **In Polar** (start with the sandbox at sandbox.polar.sh, then do the same on polar.sh):
   - Create a product: **one-time** (not a subscription), with **one fixed price**. Copy its product id. A product with
     several prices, or a recurring one, keeps checkout closed (the log says why).
   - Create an organization access token with the scopes for products, checkouts, orders and customer sessions.
   - Add a webhook endpoint `https://<your site>/api/plan/webhook/`, format "Raw", with the events `order.paid`,
     `order.refunded` and `order.updated`. Copy its secret.
   - Read Polar's Acceptable Use Policy for your product: it has rules about services for minors.

3. **In Cloudflare:**

   ```bash
   npx wrangler secret put POLAR_ACCESS_TOKEN
   ```

   ```bash
   npx wrangler secret put POLAR_WEBHOOK_SECRET
   ```

   and in `wrangler.jsonc` `vars`: `POLAR_PRODUCT_ID` (the product id), `POLAR_SERVER` (`"sandbox"` while you test,
   `""` for real payments) and `SITE_URL` (your site's address, for links in the cron's emails).

4. Create the tables, build and deploy:

   ```bash
   npm run db:migrate:remote
   ```

   ```bash
   npm run build -- --pack my-exam
   ```

   ```bash
   npm run deploy
   ```

5. Test with the sandbox: buy for a child with Polar's test card, check the thank-you screen, the "is on" email and
   the plan on the child's card; refund it in Polar and check that the plan ends and the refund email arrives. Then
   switch to production values.

Locally, put the same four `POLAR_*` values in `.dev.vars` (never commit it). Under `npm run dev` emails are not sent:
one line per email is printed in the terminal. Polar cannot reach `localhost` for webhooks, but the thank-you screen
asks Polar itself, so a test purchase still turns the plan on.

## The rules in short

| | |
|---|---|
| Price | Read from Polar (cached 10 minutes), so the page always shows what Polar charges. `plan.priceLabel` is only for the terms page. |
| Double payment | An open checkout for the same child is reused, so two tabs or a double click lead to one Polar page. |
| Granted by | The `order.paid` webhook, or the thank-you screen if the webhook is late. Both key on the order id. |
| Refund | A full refund ends the plan for that child; the child keeps their progress. A late `order.paid` cannot turn a refunded order back on. |
| Removed child | Its purchases stay (accounting) and give nothing. |
| Deleted account | Purchases stay, unlinked: no user, no email. |
| Free limits | Only while payments are on, Polar answers with a price, and the day is not before `plan.freeUntil`. Counted in the browser: honest product limits, not locks. |

Polar changes API versions about every quarter and drops each one about nine months later. `src/lib/server/polar.ts`
uses `2026-10`: move it to a newer version before Polar drops that one.
