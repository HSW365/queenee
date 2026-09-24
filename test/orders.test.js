// End-to-end tests: orders, Stripe checkout + webhook (Stripe API stubbed, real signature check), CallTwin sync.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Stripe = require('stripe');
const { createApp } = require('../server');
const { jsonStore } = require('../lib/store');

const WH = 'whsec_test_secret';
const real = Stripe('sk_test_dummy');

function harness(envExtra = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'q-')), 'orders.json');
  const store = jsonStore(file);
  const calls = { sessions: [], subUpdates: [], calltwin: [] };
  const stripe = {
    webhooks: real.webhooks,
    checkout: { sessions: {
      create: async p => { calls.sessions.push(p); return { id: 'cs_test_' + calls.sessions.length, url: 'https://checkout.stripe.com/c/pay/cs_test_' + calls.sessions.length }; },
      retrieve: async id => ({ id, status: 'open' })
    } },
    subscriptions: { update: async (id, p) => { calls.subUpdates.push([id, p]); return { id }; } }
  };
  const calltwin = { configured: true, dashboardUrl: 'https://dash.example', upsert: async a => { calls.calltwin.push(a); return { ok: true, hasPassword: !!a.password }; } };
  const env = { NODE_ENV: 'test', STRIPE_WEBHOOK_SECRET: WH, QUEENEE_ADMIN_TOKEN: 'adm', PUBLIC_BASE_URL: 'https://queenee.test', ...envExtra };
  const app = createApp({ stripe, store, calltwin, env, analyzer: async url => ({ domain: url, score: 60, plan: ['x'] }) });
  return new Promise(res => { const srv = app.listen(0, () => res({ srv, base: 'http://127.0.0.1:' + srv.address().port, store, calls })); });
}

const post = (base, p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
async function hook(base, event) {
  const payload = JSON.stringify(event);
  const sig = real.webhooks.generateTestHeaderString({ payload, secret: WH });
  return fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sig }, body: payload });
}
const order = extra => ({ siteType: 'rebuild', url: 'joesplumbing.com', business: "Joe's Plumbing", name: 'Joe', email: 'joe@example.com', terms: true, ...extra });

test('config exposes add-on plan: $99 today + $99 x 5', async () => {
  const { srv, base } = await harness();
  const c = await (await fetch(base + '/api/config')).json();
  assert.equal(c.websitePrice, 500); assert.equal(c.addon.firstPayment, 99); assert.equal(c.addon.months, 5); assert.equal(c.addon.totalPayments, 6); assert.equal(c.addon.total, 594);
  srv.close();
});

test('website-only order creates one-time $500 Stripe payment session', async () => {
  const { srv, base, calls, store } = await harness();
  const r = await post(base, '/api/orders', order());
  const d = await r.json();
  assert.equal(r.status, 201, JSON.stringify(d));
  assert.match(d.redirect, /checkout\.stripe\.com/);
  const s = calls.sessions[0];
  assert.equal(s.mode, 'payment'); assert.equal(s.line_items.length, 1); assert.equal(s.line_items[0].price_data.unit_amount, 50000);
  assert.equal(calls.calltwin.length, 0);
  // webhook marks it paid
  await hook(base, { id: 'evt1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', mode: 'payment', payment_status: 'paid', metadata: { orderId: d.id }, customer: 'cus_1', amount_total: 50000 } } });
  assert.equal((await store.get(d.id)).status, 'paid');
  srv.close();
});

test('website + CallTwin: $599 today, subscription ends after 6 payments, CallTwin activated', async () => {
  const { srv, base, calls, store } = await harness();
  const r = await post(base, '/api/orders', order({ addCallTwin: true, calltwinPassword: 'supersecret1' }));
  const d = await r.json(); assert.equal(r.status, 201, JSON.stringify(d));
  const s = calls.sessions[0];
  assert.equal(s.mode, 'subscription');
  assert.deepEqual(s.line_items.map(i => i.price_data.unit_amount), [50000, 9900]);
  assert.equal(s.line_items[0].price_data.recurring, undefined);
  assert.deepEqual(s.line_items[1].price_data.recurring, { interval: 'month' });
  assert.equal(s.subscription_data.metadata.orderId, d.id);
  // CallTwin login created up front, inactive, with password; password not stored
  assert.equal(calls.calltwin[0].status, 'none'); assert.equal(calls.calltwin[0].password, 'supersecret1');
  assert.ok(!fs.readFileSync(path.join(path.dirname(require.resolve('../server')), 'server.js'), 'utf8').includes('supersecret1'));
  const stored = await store.get(d.id); assert.ok(!JSON.stringify(stored).includes('supersecret1'));

  // First invoice may arrive before checkout.session.completed
  const inv = n => ({ id: 'evt_i' + n, type: 'invoice.paid', data: { object: { id: 'in_' + n, subscription: 'sub_1', customer: 'cus_1', subscription_details: { metadata: { orderId: d.id } } } } });
  assert.equal((await hook(base, inv(1))).status, 200);
  await hook(base, { id: 'evt_c', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', mode: 'subscription', payment_status: 'paid', subscription: 'sub_1', customer: 'cus_1', metadata: { orderId: d.id }, amount_total: 59900 } } });
  let o = await store.get(d.id);
  assert.equal(o.status, 'paid'); assert.equal(o.addonPaymentsMade, 1); assert.equal(o.calltwin.status, 'active');
  await hook(base, inv(1)); // duplicate delivery ignored
  assert.equal((await store.get(d.id)).addonPaymentsMade, 1);
  for (let n = 2; n <= 5; n++) await hook(base, inv(n));
  assert.equal(calls.subUpdates.length, 0, 'must not cancel before final payment');
  await hook(base, inv(6));
  o = await store.get(d.id);
  assert.equal(o.addonPaymentsMade, 6); assert.equal(o.addonPlanStatus, 'completed');
  assert.deepEqual(calls.subUpdates[0], ['sub_1', { cancel_at_period_end: true, metadata: { orderId: d.id, installments: 'complete' } }]);
  // subscription ends -> CallTwin stays active (CALLTWIN_AFTER_PLAN=keep)
  await hook(base, { id: 'evt_d', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', metadata: { orderId: d.id } } } });
  o = await store.get(d.id); assert.equal(o.addonPlanStatus, 'completed'); assert.equal(o.calltwin.status, 'active');
  srv.close();
});

test('failed payment pauses CallTwin; early cancel shuts it off', async () => {
  const { srv, base, store } = await harness();
  const d = await (await post(base, '/api/orders', order({ addCallTwin: true, calltwinPassword: 'supersecret1' }))).json();
  const meta = { parent: { subscription_details: { subscription: 'sub_9', metadata: { orderId: d.id } } } };
  await hook(base, { id: 'e1', type: 'invoice.paid', data: { object: { id: 'in_a', ...meta } } });
  await hook(base, { id: 'e2', type: 'invoice.payment_failed', data: { object: { id: 'in_b', ...meta } } });
  let o = await store.get(d.id); assert.equal(o.addonPlanStatus, 'past_due'); assert.equal(o.calltwin.status, 'past_due');
  await hook(base, { id: 'e3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_9', metadata: { orderId: d.id } } } });
  o = await store.get(d.id); assert.equal(o.addonPlanStatus, 'canceled'); assert.equal(o.calltwin.status, 'canceled');
  srv.close();
});

test('bad webhook signature rejected', async () => {
  const { srv, base } = await harness();
  const r = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=bad' }, body: '{}' });
  assert.equal(r.status, 400); srv.close();
});

test('owner email is comped: no checkout, CallTwin active immediately', async () => {
  const { srv, base, calls, store } = await harness();
  const d = await (await post(base, '/api/orders', order({ email: 'HSW365media@gmail.com', addCallTwin: true, calltwinPassword: 'supersecret1' }))).json();
  assert.equal(calls.sessions.length, 0); assert.match(d.redirect, /success\.html/);
  const o = await store.get(d.id); assert.equal(o.comp, true); assert.equal(o.status, 'paid'); assert.equal(o.calltwin.status, 'active');
  srv.close();
});

test('new-website order needs no URL; validation errors are clear', async () => {
  const { srv, base } = await harness();
  assert.equal((await post(base, '/api/orders', order({ siteType: 'new', url: '' }))).status, 201);
  const bad = await post(base, '/api/orders', order({ url: '' })); assert.equal(bad.status, 400);
  const pw = await post(base, '/api/orders', order({ addCallTwin: true, calltwinPassword: 'short' })); assert.match((await pw.json()).error, /8 characters/);
  const t = await post(base, '/api/orders', order({ terms: false })); assert.equal(t.status, 400);
  srv.close();
});

test('success page status requires order token; admin requires admin token', async () => {
  const { srv, base } = await harness();
  const d = await (await post(base, '/api/orders', order())).json();
  assert.equal((await fetch(base + '/api/orders/' + d.id + '?t=wrong')).status, 404);
  const t = new URL(d.redirect.startsWith('http') && d.redirect.includes('success') ? d.redirect : 'http://x/?t=').searchParams.get('t');
  const list = await fetch(base + '/api/admin/orders'); assert.equal(list.status, 401);
  const ok = await (await fetch(base + '/api/admin/orders', { headers: { 'x-queenee-admin': 'adm' } })).json();
  assert.equal(ok.length, 1); assert.equal(ok[0].token, undefined);
  const pub = await (await fetch(base + '/api/orders/' + d.id + '?t=' + ok.length)).status; assert.equal(pub, 404);
  srv.close();
});

test('landing page and health served', async () => {
  const { srv, base } = await harness();
  const html = await (await fetch(base + '/')).text(); assert.match(html, /QUEEN<span>EE/); assert.match(html, /id="order"/);
  const h = await (await fetch(base + '/health')).json(); assert.equal(h.ok, true); assert.equal(h.stripe, true);
  assert.equal((await fetch(base + '/pay.html', { redirect: 'manual' })).status, 302);
  srv.close();
});
