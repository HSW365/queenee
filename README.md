# QUEENEE — HSW365 Website Rebuild System

QUEENEE is the customer-facing website rebuild product: analyze an existing public business website, capture a project brief, route the $500 one-time payment, and manage the intake through a protected admin API.

## Product model

- **QUEENEE Website Rebuild:** $500 one-time standard offer.
- **Custom Website Build:** scope-based quote for larger businesses, portals, multi-location sites and advanced integrations.
- **CallTwin:** separate 24/7 AI receptionist. It can be purchased independently or offered as an upsell. The products are intentionally not bundled.

## What is working

1. Public website analyzer with SSRF protection and a 10-second fetch timeout.
2. Customer intake form for owner, business, website, goals, services and notes.
3. Project IDs generated server-side and intake records stored by the backend.
4. Stripe payment-link routing through `/api/checkout` and `/api/config`.
5. Protected admin endpoints using `QUEENEE_ADMIN_TOKEN`.
6. `/health` endpoint for deployment monitoring.
7. Render deployment configuration.
8. GitHub Actions smoke test on every push and pull request to `main`.
9. No Twilio dependency.

## Local run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Environment variables

- `PORT` — supplied by Render automatically.
- `STRIPE_PAYMENT_URL` — optional override for the live $500 Stripe Payment Link. The repository currently contains the configured payment-link fallback.
- `QUEENEE_ADMIN_TOKEN` — required to use protected project-management endpoints.

## API

### Analyze a site

`POST /api/analyze`

```json
{"url":"https://example.com"}
```

Returns title, description, headings, navigation/link counts, CTA count, image/form counts and a rebuild plan.

### Create a project

`POST /api/intake`

```json
{"name":"Owner","email":"owner@example.com","business":"Example Business","url":"https://example.com","goal":"Generate more leads","services":"Service A, Service B","notes":"Need a stronger booking flow"}
```

Returns a project ID, analysis and payment URL.

### Payment

`GET /api/checkout` redirects to the configured Stripe Payment Link.

### Admin

Send `x-queenee-admin: YOUR_TOKEN`.

- `GET /api/intakes` — latest 100 projects.
- `GET /api/intake/:id` — one project.
- `PATCH /api/intake/:id` with `{ "status": "in-progress" }` — update project status.

## Render

`render.yaml` runs `npm install`, starts `node server.js`, and monitors `/health`. Add `QUEENEE_ADMIN_TOKEN` and, if desired, `STRIPE_PAYMENT_URL` in the Render environment settings rather than committing secrets.

## Important production note

The default intake store is a JSON file. This is suitable for an initial deployment but Render's filesystem can be ephemeral. For production scale, replace `readData/writeData` with Supabase/Postgres or another persistent database. The API contract is already separated so that storage can be swapped without redesigning the customer UI.
