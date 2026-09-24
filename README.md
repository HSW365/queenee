# QUEENEE — HSW365 Websites + CallTwin

QUEENEE is the landing page HSW365 sends traffic to. Business owners (or anyone who needs a site) order a **new website or a rebuild**, can add the **CallTwin 24/7 AI receptionist**, pay through Stripe, and get a CallTwin dashboard login that switches on when the payment clears.

## Offer

| Item | Price | Billing |
|---|---|---|
| Business website (new or rebuild) | $500 | One-time |
| CallTwin add-on | $99 today, then $99/month for 5 months | Stripe subscription that stops itself after the 6th payment ($594 total) |

Website + CallTwin = **$599 due today**, then $99/month × 5.

All prices are env vars (`WEBSITE_PRICE_CENTS`, `CALLTWIN_ADDON_CENTS`, `CALLTWIN_ADDON_MONTHS`), and the landing page reads them from `/api/config`, so the page and checkout always match.

## Flow

1. The visitor lands on `/`. They can scan their current site for free (`/api/analyze`) and fill in the order form.
2. `POST /api/orders` saves the order. If CallTwin was added, it **creates the customer's CallTwin login right away** (inactive) through CallTwin's partner API, using the password they chose. QUEENEE never stores that password.
3. The customer goes to Stripe Checkout:
   - Website only: `mode=payment`, $500.
   - Website + CallTwin: `mode=subscription` with the $500 one-time item plus a $99/month recurring item. That comes to $599 on day one.
4. The Stripe webhook (`/api/stripe/webhook`) handles the rest:
   - `checkout.session.completed`: marks the order paid and sets CallTwin to **active**.
   - `invoice.paid`: counts the installments, skipping duplicate deliveries. At installment 6 it sets `cancel_at_period_end`, so there is no 7th charge.
   - `invoice.payment_failed`: pauses CallTwin (`past_due`).
   - `customer.subscription.deleted`: if all 6 payments are in, CallTwin **stays active** (`CALLTWIN_AFTER_PLAN=keep`; set it to `end` to switch CallTwin off when the plan ends). If the subscription ended early, CallTwin is canceled.
5. `/success.html` shows the order status, how far along the payment plan is, and the CallTwin login details. If the webhook hasn't arrived yet, it checks with Stripe directly.
6. `/admin.html` lists every order, with status changes, notes, live URL, a CallTwin re-sync button and CSV export (it needs `QUEENEE_ADMIN_TOKEN`).

Orders placed with an owner email (`hsw365media@gmail.com`, `hoodstarent365@gmail.com`, or whatever `OWNER_EMAILS` is set to) are comped. They skip payment and CallTwin turns on immediately.

## Environment (Render)

| Var | Required | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | Turns on Stripe Checkout. Without it, orders fall back to the static payment link (website only). |
| `STRIPE_WEBHOOK_SECRET` | yes | From the Stripe webhook endpoint `https://<queenee>/api/stripe/webhook`. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`. |
| `PUBLIC_BASE_URL` | yes | e.g. `https://queenee.onrender.com` or your custom domain. |
| `MONGODB_URI` | recommended | Keeps orders safe across Render restarts. Without it, orders go to a JSON file that Render wipes on redeploy. |
| `QUEENEE_ADMIN_TOKEN` | yes | For the admin page and API. |
| `CALLTWIN_API_URL` | yes | `https://calltwin.onrender.com` |
| `CALLTWIN_PARTNER_KEY` | yes | Must match `PARTNER_API_KEY` on the CallTwin service. |
| `CALLTWIN_DASHBOARD_URL` | optional | Where the success page sends CallTwin customers to log in. |
| `CALLTWIN_AFTER_PLAN` | optional | `keep` (default) or `end`. |
| `OWNER_EMAILS` | optional | Comma-separated list of comped emails. |

## API

- `GET /api/config`: prices and plan details
- `POST /api/analyze`: `{ url }` returns a site score and a fix list
- `POST /api/orders`: create an order and get `{ redirect }` back (Stripe Checkout URL, or the success page for comped orders)
- `GET /api/orders/:id?t=TOKEN`: public order status (the token is in the success URL)
- `POST /api/stripe/webhook`: Stripe events
- Admin (header `x-queenee-admin`): `GET /api/admin/orders`, `GET|PATCH /api/admin/orders/:id`, `POST /api/admin/orders/:id/calltwin-sync`
- `GET /health`

## Develop

```bash
npm install
npm test      # end-to-end order, webhook and installment tests (Stripe API stubbed, real signature checks)
npm start     # http://localhost:3000
```

Stripe CLI for local webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
