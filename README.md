# QUEENEE: HSW365 website building

QUEENEE is the landing page HSW365 sends traffic to. It sells website builds to indie artists, business owners and anyone who needs a site, with CallTwin as an add-on for businesses.

Live at **https://hsw365.github.io/queenee/** (GitHub Pages, `main` branch).

| Package | Price |
|---|---|
| Website (new or rebuild) | $500 one-time |
| Website + CallTwin | $599 today, then $99/month for 5 months |
| Voice AI Agent | $997/month, 5,000 minutes included, first month due at sign-up |
| Video Platform | $146/month (own video + streaming network), first month due at sign-up |

Prices are not shown on the landing page. Visitors see them in the sign-up popup.

## How it works

1. A visitor clicks **Sign up**, picks a package and fills in who they are (artist, business or something else).
2. The order is saved and they get an order number (`Q-XXXXXXX`).
3. They pay by **Cash App**, **Zelle** or **card (Stripe)** and put the order number in the note.
4. The order shows up in `admin.html`, where HSW365 marks it paid, building and delivered.

```
GitHub Pages (this repo)                 Supabase (klipit project)
index.html  sign-up popup   ───────▶  edge function "queenee"  ──▶  table queenee_orders
admin.html  order list      ───────▶  (owner key required)          table queenee_settings (payment handles)
```

## Files

- `index.html`: landing page and sign-up popup. `index-v2.html` is a copy the publish workflow reads; keep the two identical.
- `config.js`: backend URL, the prices shown on the page, CallTwin link, contact email.
- `admin.html`: order list, status updates, CSV export. Needs the owner key.
- `supabase/functions/queenee/index.ts`: the backend (source of the deployed edge function).
- `server.js`, `pay.html`, `render.yaml`: the earlier Node version. Not used by the live site.

## Voice AI Agent

- Buy link: `https://hsw365.github.io/queenee/?buy=voice` opens the sign-up on the voice package (CallTwin links here).
- After sign-up the customer records their voice in the browser (or uploads a studio file). Files go to the private `queenee-voice` storage bucket, under the order number, max 8 per order.
- `admin.html` plays and downloads each order's recordings.
- Card for voice orders shows only when `stripe_voice_link` is set in `queenee_settings` (a $997 Stripe link). Until then voice orders pay by Cash App or Zelle.

## Video Platform

- Buy link: `https://hsw365.github.io/queenee/?buy=video`.
- Card shows only when `stripe_video_link` is set in `queenee_settings` (a $146 Stripe link). Until then: Cash App or Zelle.

## Changing things

- **Cash App, Zelle or Stripe link:** edit row `id = 1` in the `queenee_settings` table. No redeploy needed.
- **Prices:** change `prices` in `config.js` and `PRICES` in the edge function so they match.
- **Owner key:** the edge function stores only the sha256 of the key in `ADMIN_HASH`. To rotate it, hash a new key and redeploy.

Orders placed with an owner email (`hsw365media@gmail.com`, `hoodstarent365@gmail.com`) are comped and skip payment.

## Not automatic yet

- Card payments are matched by hand: Stripe checkout carries the order number as the client reference, and the order is marked paid in `admin.html`.
- CallTwin monthly payments are billed by HSW365; there is no auto-renewing subscription behind the $99/month.
- New orders do not send an email alert. Check `admin.html`.
