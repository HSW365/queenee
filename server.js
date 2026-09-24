// QUEENEE — HSW365 website builder + CallTwin add-on.
// Landing page, order intake, Stripe checkout, Stripe webhook, CallTwin provisioning, admin API.
const express = require('express');
const dns = require('dns').promises;
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { load } = require('cheerio');
const { createStore } = require('./lib/store');
const { createCallTwin } = require('./lib/calltwin');

const cents = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };

function config(env = process.env) {
  return {
    websiteCents: cents(env.WEBSITE_PRICE_CENTS, 50000),
    addonCents: cents(env.CALLTWIN_ADDON_CENTS, 9900),
    addonMonths: cents(env.CALLTWIN_ADDON_MONTHS, 5), // monthly charges AFTER the first-day charge
    afterPlan: (env.CALLTWIN_AFTER_PLAN || 'keep').toLowerCase() === 'end' ? 'end' : 'keep',
    publicUrl: (env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    adminToken: env.QUEENEE_ADMIN_TOKEN || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    fallbackPaymentUrl: env.STRIPE_PAYMENT_URL || 'https://buy.stripe.com/6oU7sL4L5dMO182b3Z3VC0o',
    ownerEmails: (env.OWNER_EMAILS || 'hsw365media@gmail.com,hoodstarent365@gmail.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    contactEmail: env.CONTACT_EMAIL || 'hsw365media@gmail.com'
  };
}

// ---------- helpers ----------
function privateIp(ip) {
  if (net.isIP(ip) === 4) { const p = ip.split('.').map(Number); return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127); }
  return net.isIP(ip) === 6 && (ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip) || /^::ffff:/i.test(ip));
}
const clean = (s, max = 1000) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normalize = raw => { const s = String(raw || '').trim(); return /^https?:\/\//i.test(s) ? s : 'https://' + s; };
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const money = c => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);

async function target(raw) {
  let u; try { u = new URL(normalize(raw)); } catch { throw Error('Enter a valid website URL.'); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw Error('Only public HTTP/HTTPS URLs are supported.');
  const a = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!a.length || a.some(x => privateIp(x.address))) throw Error('That public domain could not be safely resolved.');
  return u;
}

async function analyze(raw) {
  const u = await target(raw); const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 10000); let html;
  try {
    const r = await fetch(u, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'QUEENEE/4.0 website analyzer' } });
    if (!r.ok) throw Error('Website returned HTTP ' + r.status);
    html = (await r.text()).slice(0, 3000000);
  } finally { clearTimeout(tm); }
  const $ = load(html);
  const title = clean($('title').first().text());
  const description = clean($('meta[name="description"]').attr('content'));
  const headings = $('h1,h2,h3').map((_, e) => clean($(e).text())).get().filter(Boolean).slice(0, 30);
  const links = $('a[href]').map((_, e) => ({ text: clean($(e).text()), href: $(e).attr('href') || '' })).get().slice(0, 100);
  const cta = links.filter(x => /book|quote|contact|call|schedule|start|get started|buy|shop|appointment|consult|request/i.test(x.text)).length;
  const phone = /tel:|\(\d{3}\)\s?\d{3}-\d{4}|\d{3}[-.]\d{3}[-.]\d{4}/.test(html);
  const viewport = $('meta[name="viewport"]').length > 0;
  const plan = [];
  if (!title) plan.push('Add a clear, benefit-led page title.');
  if (!description) plan.push('Add a concise meta description for search results.');
  if (!viewport) plan.push('Site is not mobile-ready. Rebuild with a mobile-first layout.');
  if (headings.length < 3) plan.push('Strengthen the service, proof, FAQ and offer structure.');
  if (cta === 0) plan.push('Add prominent calls to action and lead capture.');
  if (!phone) plan.push('Surface a click-to-call phone number. Pair it with CallTwin so no call goes unanswered.');
  if (links.length < 4) plan.push('Improve navigation and internal pathways.');
  plan.push('Structure business content for Google and AI assistants.', 'Tighten speed, trust signals and conversion paths.');
  const score = Math.max(20, 100 - plan.length * 9);
  return { domain: u.hostname.replace(/^www\./, ''), url: u.toString(), title, description, headings: headings.slice(0, 10), nav: links.filter(x => x.text).slice(0, 12).map(x => x.text), linksTotal: links.length, cta, images: $('img').length, forms: $('form').length, mobileReady: viewport, phoneVisible: phone, score, plan };
}

// Stripe invoice → subscription id + metadata across API versions.
function invoiceSub(inv) {
  const sub = inv.subscription || inv.parent?.subscription_details?.subscription || null;
  const meta = inv.subscription_details?.metadata || inv.parent?.subscription_details?.metadata || {};
  return { subscriptionId: typeof sub === 'object' && sub ? sub.id : sub, orderId: meta.orderId || null };
}

// ---------- app ----------
function createApp({ stripe = null, store = createStore(), calltwin = createCallTwin(), env = process.env, analyzer = analyze } = {}) {
  const cfg = config(env);
  const app = express();
  const totalAddonPayments = 1 + cfg.addonMonths;
  const log = (...a) => { if (env.NODE_ENV !== 'test') console.log('[queenee]', ...a); };

  const publicBase = req => cfg.publicUrl || `${req.protocol}://${req.get('host')}`;
  const isOwner = email => cfg.ownerEmails.includes(String(email).toLowerCase());
  const safeEqual = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const admin = (req, res, next) => (cfg.adminToken && safeEqual(req.get('x-queenee-admin'), cfg.adminToken)) ? next() : res.status(401).json({ error: 'Unauthorized' });

  async function syncCallTwin(order, status, extra = {}) {
    if (!order.addCallTwin) return order;
    const r = await calltwin.upsert({ email: order.email, businessName: order.business, status, ref: order.id, ...extra });
    const ct = { ...(order.calltwin || {}), status, syncedAt: new Date().toISOString(), synced: !!r.ok, error: r.ok ? null : r.error, hasPassword: r.hasPassword ?? order.calltwin?.hasPassword ?? false };
    log('calltwin sync', order.id, status, r.ok ? 'ok' : r.error);
    return (await store.update(order.id, { calltwin: ct })) || order;
  }

  function publicView(o) {
    return {
      id: o.id, business: o.business, email: o.email, status: o.status, createdAt: o.createdAt,
      website: { type: o.siteType, url: o.url || null, price: money(o.websiteCents) },
      addCallTwin: !!o.addCallTwin,
      calltwin: o.addCallTwin ? { status: o.calltwin?.status || 'pending', paymentsMade: o.addonPaymentsMade || 0, totalPayments: o.addonTotalPayments, planStatus: o.addonPlanStatus || 'pending', dashboardUrl: calltwin.dashboardUrl, apiBase: env.CALLTWIN_API_URL || 'https://calltwin.onrender.com', accountReady: !!o.calltwin?.synced } : null,
      dueToday: money(o.dueTodayCents), comp: !!o.comp
    };
  }

  // Stripe webhook needs the raw body — mount before express.json.
  app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    if (!stripe || !cfg.webhookSecret) return res.status(503).json({ error: 'Stripe webhook not configured' });
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), cfg.webhookSecret); }
    catch (e) { return res.status(400).send('Webhook Error: ' + e.message); }
    try { await handleEvent(event); res.json({ received: true }); }
    catch (e) { console.error('[queenee webhook]', event.type, e); res.status(500).json({ error: 'Webhook handler failed' }); }
  });

  async function handleEvent(event) {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const orderId = obj.metadata?.orderId || obj.client_reference_id;
        let order = orderId && await store.get(orderId);
        if (!order) return;
        if (obj.payment_status !== 'paid' && obj.payment_status !== 'no_payment_required') { await store.update(order.id, { status: 'payment_processing' }); return; }
        order = await store.update(order.id, {
          status: order.status === 'in_progress' || order.status === 'delivered' ? order.status : 'paid',
          paidAt: order.paidAt || new Date().toISOString(),
          stripeCustomerId: obj.customer || order.stripeCustomerId || null,
          stripeSubscriptionId: obj.subscription || order.stripeSubscriptionId || null,
          amountPaidTodayCents: obj.amount_total ?? order.dueTodayCents,
          addonPlanStatus: order.addCallTwin ? (order.addonPlanStatus === 'completed' ? 'completed' : 'active') : undefined
        });
        if (order.addCallTwin) order = await syncCallTwin(order, 'active', { stripeCustomerId: order.stripeCustomerId || undefined });
        return;
      }
      case 'invoice.paid': {
        const { subscriptionId, orderId } = invoiceSub(obj);
        if (!subscriptionId) return;
        let order = (orderId && await store.get(orderId)) || await store.findOne({ stripeSubscriptionId: subscriptionId });
        if (!order || !order.addCallTwin) return;
        const seen = order.addonInvoiceIds || [];
        if (seen.includes(obj.id)) return; // idempotent
        const ids = [...seen, obj.id];
        const made = ids.length;
        const done = made >= totalAddonPayments;
        order = await store.update(order.id, { addonInvoiceIds: ids, addonPaymentsMade: made, stripeSubscriptionId: subscriptionId, addonPlanStatus: done ? 'completed' : 'active', lastAddonPaymentAt: new Date().toISOString() });
        if (done) {
          // Final installment collected: stop the subscription from billing again.
          await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true, metadata: { orderId: order.id, installments: 'complete' } });
        }
        if (order.calltwin?.status !== 'active') order = await syncCallTwin(order, 'active');
        return;
      }
      case 'invoice.payment_failed': {
        const { subscriptionId, orderId } = invoiceSub(obj);
        if (!subscriptionId) return;
        let order = (orderId && await store.get(orderId)) || await store.findOne({ stripeSubscriptionId: subscriptionId });
        if (!order || !order.addCallTwin) return;
        order = await store.update(order.id, { addonPlanStatus: 'past_due' });
        await syncCallTwin(order, 'past_due');
        return;
      }
      case 'customer.subscription.deleted': {
        let order = (obj.metadata?.orderId && await store.get(obj.metadata.orderId)) || await store.findOne({ stripeSubscriptionId: obj.id });
        if (!order || !order.addCallTwin) return;
        const complete = (order.addonPaymentsMade || 0) >= totalAddonPayments;
        order = await store.update(order.id, { addonPlanStatus: complete ? 'completed' : 'canceled', addonEndedAt: new Date().toISOString() });
        const status = complete && cfg.afterPlan === 'keep' ? 'active' : 'canceled';
        await syncCallTwin(order, status);
        return;
      }
      default: return;
    }
  }
  app.locals.handleEvent = handleEvent;

  app.use(express.json({ limit: '128kb' }));

  // ---------- public API ----------
  app.get('/api/config', (req, res) => res.json({
    websitePrice: cfg.websiteCents / 100,
    addon: { name: 'CallTwin 24/7 AI Receptionist', firstPayment: cfg.addonCents / 100, monthly: cfg.addonCents / 100, months: cfg.addonMonths, totalPayments: totalAddonPayments, total: (cfg.addonCents * totalAddonPayments) / 100 },
    checkout: stripe ? 'stripe' : 'payment-link',
    contactEmail: cfg.contactEmail
  }));

  app.post('/api/analyze', async (req, res) => {
    try { res.json(await analyzer(req.body?.url)); }
    catch (e) { res.status(400).json({ error: e.name === 'AbortError' ? 'Website timed out while being read.' : e.message || 'Analysis failed.' }); }
  });

  app.post('/api/orders', async (req, res) => {
    try {
      const b = req.body || {};
      const email = clean(b.email, 200).toLowerCase();
      const siteType = b.siteType === 'new' ? 'new' : 'rebuild';
      const url = clean(b.url, 500);
      const addCallTwin = b.addCallTwin === true || b.addCallTwin === 'true' || b.addCallTwin === 'on';
      if (!clean(b.name) || !email || !clean(b.business)) throw Error('Name, email and business name are required.');
      if (!validEmail(email)) throw Error('Enter a valid email address.');
      if (siteType === 'rebuild' && !url) throw Error('Enter your current website address, or choose "I need a new website".');
      if (!b.terms) throw Error('Please accept the order terms.');
      const password = String(b.calltwinPassword || '');
      if (addCallTwin && password.length < 8) throw Error('Choose a CallTwin dashboard password of at least 8 characters.');

      const comp = isOwner(email);
      const dueTodayCents = comp ? 0 : cfg.websiteCents + (addCallTwin ? cfg.addonCents : 0);
      const id = 'Q-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const token = crypto.randomBytes(16).toString('hex');
      const analysis = siteType === 'rebuild' && url ? await analyzer(url).catch(e => ({ error: e.message })) : null;

      let order = await store.create({
        id, token, createdAt: new Date().toISOString(), status: comp ? 'paid' : 'pending_payment', comp,
        name: clean(b.name, 120), email, phone: clean(b.phone, 40), business: clean(b.business, 160),
        industry: clean(b.industry, 120), location: clean(b.location, 160),
        siteType, url: url ? normalize(url) : '', goal: clean(b.goal), services: clean(b.services, 2000),
        style: clean(b.style, 500), notes: clean(b.notes, 2000),
        websiteCents: cfg.websiteCents, addCallTwin,
        addonCents: addCallTwin ? cfg.addonCents : 0, addonTotalPayments: addCallTwin ? totalAddonPayments : 0,
        addonPaymentsMade: 0, addonPlanStatus: addCallTwin ? (comp ? 'comp' : 'pending') : null,
        dueTodayCents, analysis, paidAt: comp ? new Date().toISOString() : null
      });

      // Create the CallTwin login now (inactive until paid) so the password is never stored by QUEENEE.
      if (addCallTwin) order = await syncCallTwin({ ...order }, comp ? 'active' : 'none', { password });

      const base = publicBase(req);
      const successUrl = `${base}/success.html?order=${id}&t=${token}`;
      if (comp) return res.status(201).json({ ok: true, id, redirect: successUrl });

      if (!stripe) {
        // No Stripe API key: fall back to the static payment link (website only).
        const url = addCallTwin && env.STRIPE_ADDON_PAYMENT_URL ? env.STRIPE_ADDON_PAYMENT_URL : cfg.fallbackPaymentUrl;
        await store.update(id, { checkout: 'payment-link' });
        return res.status(201).json({ ok: true, id, redirect: url + (url.includes('?') ? '&' : '?') + 'client_reference_id=' + id + '&prefilled_email=' + encodeURIComponent(email) });
      }

      const websiteItem = { quantity: 1, price_data: { currency: 'usd', unit_amount: cfg.websiteCents, product_data: { name: siteType === 'new' ? 'QUEENEE New Business Website' : 'QUEENEE Website Rebuild', description: 'One-time build. Mobile-first design, conversion structure, launch.' } } };
      const common = {
        client_reference_id: id, customer_email: email,
        metadata: { orderId: id, business: order.business.slice(0, 100), addCallTwin: String(addCallTwin) },
        success_url: successUrl + '&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: `${base}/?canceled=${id}#order`,
        allow_promotion_codes: true
      };
      let session;
      if (addCallTwin) {
        session = await stripe.checkout.sessions.create({
          ...common, mode: 'subscription',
          line_items: [
            websiteItem,
            { quantity: 1, price_data: { currency: 'usd', unit_amount: cfg.addonCents, recurring: { interval: 'month' }, product_data: { name: 'CallTwin 24/7 AI Receptionist (add-on)', description: `${money(cfg.addonCents)} today, then ${money(cfg.addonCents)}/month for ${cfg.addonMonths} months. Ends automatically.` } } }
          ],
          subscription_data: { metadata: { orderId: id, plan: 'calltwin-addon', totalPayments: String(totalAddonPayments) }, description: `CallTwin add-on for ${order.business}` }
        });
      } else {
        session = await stripe.checkout.sessions.create({ ...common, mode: 'payment', line_items: [websiteItem], customer_creation: 'always', payment_intent_data: { metadata: { orderId: id } } });
      }
      await store.update(id, { stripeSessionId: session.id, checkout: 'stripe' });
      res.status(201).json({ ok: true, id, redirect: session.url });
    } catch (e) {
      console.error('[queenee order]', e.message);
      res.status(400).json({ error: e.message || 'Order failed.' });
    }
  });

  // Order status for the success page (requires the per-order token).
  app.get('/api/orders/:id', async (req, res) => {
    const o = await store.get(req.params.id);
    if (!o || !safeEqual(req.query.t, o.token)) return res.status(404).json({ error: 'Order not found' });
    // If the webhook hasn't landed yet, confirm directly with Stripe.
    if (stripe && o.status === 'pending_payment' && o.stripeSessionId && req.query.session_id === o.stripeSessionId) {
      try {
        const s = await stripe.checkout.sessions.retrieve(o.stripeSessionId);
        if (s.status === 'complete') await handleEvent({ type: 'checkout.session.completed', data: { object: s } });
      } catch (e) { log('session check failed', e.message); }
    }
    res.json(publicView(await store.get(o.id)));
  });

  // Legacy endpoints kept for old links.
  app.post('/api/intake', (req, res) => res.status(410).json({ error: 'Use /api/orders', orderUrl: '/#order' }));
  app.get('/api/checkout', (req, res) => res.redirect('/#order'));
  app.get('/pay.html', (req, res) => res.redirect('/#order'));

  // ---------- admin ----------
  app.get('/api/admin/orders', admin, async (req, res) => res.json((await store.list(300)).map(({ token, ...o }) => o)));
  app.get('/api/admin/orders/:id', admin, async (req, res) => { const o = await store.get(req.params.id); if (!o) return res.status(404).json({ error: 'Not found' }); const { token, ...rest } = o; res.json(rest); });
  app.patch('/api/admin/orders/:id', admin, async (req, res) => {
    const allowed = ['pending_payment', 'paid', 'in_progress', 'review', 'delivered', 'canceled', 'refunded'];
    const status = clean(req.body?.status);
    const patch = {};
    if (status) { if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' }); patch.status = status; }
    if (typeof req.body?.adminNotes === 'string') patch.adminNotes = clean(req.body.adminNotes, 4000);
    if (typeof req.body?.liveUrl === 'string') patch.liveUrl = clean(req.body.liveUrl, 500);
    const o = await store.update(req.params.id, patch); if (!o) return res.status(404).json({ error: 'Not found' });
    const { token, ...rest } = o; res.json(rest);
  });
  app.post('/api/admin/orders/:id/calltwin-sync', admin, async (req, res) => {
    const o = await store.get(req.params.id); if (!o) return res.status(404).json({ error: 'Not found' });
    if (!o.addCallTwin) return res.status(400).json({ error: 'Order has no CallTwin add-on' });
    const paidUp = o.comp || ['active', 'completed'].includes(o.addonPlanStatus);
    const status = req.body?.status || (o.addonPlanStatus === 'past_due' ? 'past_due' : o.addonPlanStatus === 'canceled' ? 'canceled' : paidUp ? 'active' : 'none');
    const r = await syncCallTwin(o, status); const { token, ...rest } = r; res.json(rest);
  });

  app.get('/health', (req, res) => res.json({ ok: true, service: 'QUEENEE', version: '4.0.0', store: store.kind, stripe: !!stripe, webhook: !!cfg.webhookSecret, calltwin: calltwin.configured }));

  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));
  return app;
}

if (require.main === module) {
  const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
  const app = createApp({ stripe });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('QUEENEE listening on ' + PORT + (stripe ? ' (Stripe checkout)' : ' (payment-link fallback)')));
}

module.exports = { createApp, analyze, config };
