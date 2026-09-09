# QUEENEE AI Website Rebuilder

QUEENEE is the HSW365 website-rebuild product. It analyzes a public business domain and turns the existing content into a modern rebuild blueprint.

## Product separation

- QUEENEE: website analysis, rebuild and launch service.
- CallTwin: separate 24/7 AI receptionist product and optional upsell.
- Website rebuild offer: $500 one-time for the standard rebuild; larger operations receive a custom quote.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Deploy

This repo includes `render.yaml` for a Node web service. Set the service root to the repository and deploy with Render. No Twilio dependency is used by QUEENEE.

## API

`POST /api/analyze`

Body:
```json
{"url":"https://example.com"}
```

The analyzer validates the hostname, blocks private/local IP destinations, fetches public HTML, extracts title/description/headings/links/forms/images, and returns rebuild priorities.

`GET /health` returns the service health payload.

## Payments

The site advertises the $500 one-time service. A live Stripe Checkout/payment link still requires a successfully created Stripe price/payment link and should be inserted into the CTA after the merchant confirms the connected live Stripe account. No fake payment endpoint is included.
