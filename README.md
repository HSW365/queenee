# QUEENEE: HSW365 Websites + CallTwin

QUEENEE is the landing page HSW365 sends traffic to. It is a **static site hosted on GitHub Pages**: HTML files only, nothing to deploy or keep running.

A visitor clicks **Sign up** and a popup opens with the offers:

| Package | Price |
|---|---|
| Business website (new or rebuild) | $500 one-time |
| Website + CallTwin add-on | $599 today, then $99/month for 5 months (stops on its own after 6 CallTwin payments) |

They pick one, fill in their business details (plus a CallTwin password if they chose the add-on), and go to Stripe to pay.

## How it fits together

```
GitHub Pages (this repo)          CallTwin backend on Render           Stripe
index.html  signup popup  ─────▶  POST /api/queenee/orders   (saves order, creates CallTwin login, inactive)
            redirect      ─────────────────────────────────────────▶  Payment Link checkout
success.html              ◀──────────────────────────────────────────  redirect after payment
            status        ─────▶  GET /api/queenee/...
                                  /api/webhooks/stripe  ◀──────────  paid / invoice / failed / canceled events
                                  (turns CallTwin on, counts the 6 payments, stops billing after the last one)
admin.html                ─────▶  GET /api/queenee/admin/orders
```

GitHub Pages can't take payments or listen for Stripe events on its own, so that part runs on the CallTwin backend, which is already live with Stripe and MongoDB. That code is in HSW365/calltwin `backend/routes/queenee.js`.

## Files

- `config.js`: **the only file you edit.** Payment Links, prices shown on the page, CallTwin API and dashboard URLs, contact email.
- `index.html`: the landing page and signup popup.
- `success.html`: where Stripe sends the customer after they pay. Shows the order and the CallTwin login.
- `admin.html`: order list, status updates and CSV export. Needs `QUEENEE_ADMIN_TOKEN`.

## Setup

1. **GitHub Pages:** repo Settings → Pages → Deploy from a branch → `main` / root. The site will be at `https://hsw365.github.io/queenee/`.
2. **Stripe Payment Links** (Stripe Dashboard → Payment Links):
   - **Website:** $500 one-time. The existing link is already in `config.js`.
   - **Website + CallTwin:** create a new link with *two* products: "QUEENEE Website" at $500 one-time, and "CallTwin add-on" at $99 recurring monthly. Paste its URL into `paymentLinks.bundle` in `config.js`.
   - On **both** links, under After payment, choose "Don't show confirmation page", pick "Redirect customers to your website", and enter `https://hsw365.github.io/queenee/success.html?session_id={CHECKOUT_SESSION_ID}`.
   - Optional: add the two link IDs (`plink_...`) to `QUEENEE_PAYMENT_LINK_IDS` on CallTwin. Then a payment is still caught even if someone opens the link directly.
3. **CallTwin Render env:** set `QUEENEE_ADMIN_TOKEN` (any long random string). `QUEENEE_ORIGINS`, `CALLTWIN_ADDON_MONTHS=5` and `CALLTWIN_AFTER_PLAN=keep` come from render.yaml. The Stripe webhook needs `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed` and `customer.subscription.deleted`, which CallTwin's webhook already listens for.
4. If you move to a custom domain, add it to `QUEENEE_ORIGINS` on CallTwin.

Orders placed with an owner email (`hsw365media@gmail.com`, `hoodstarent365@gmail.com`) are comped. They skip payment and CallTwin turns on immediately.
