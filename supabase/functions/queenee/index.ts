// QUEENEE backend: order intake, payment tracking and the owner order list.
// Runs as a Supabase Edge Function. The static site on GitHub Pages calls it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// sha256 of the owner key used on admin.html. The key itself is never stored.
const ADMIN_HASH = "9d0f85caeedce9a45840b764d79d0261727fe93766fc9290a842c04372bf623a";

const PRICES = { website: 500, addon: 99, addonMonths: 5 };
// Payment handles live in the queenee_settings table so they can change without a redeploy.
async function paymentSettings() {
  const r = await db("queenee_settings?select=stripe_link,cashapp_tag,zelle_handle,payee&id=eq.1");
  const s = r[0] || {};
  return { stripe: s.stripe_link || "", cashtag: s.cashapp_tag || "", zelle: s.zelle_handle || "", payee: s.payee || "HSW365 Media LLC" };
}
const OWNER_EMAILS = ["hsw365media@gmail.com", "hoodstarent365@gmail.com"];
const STATUSES = ["new", "checkout_started", "payment_reported", "paid", "in_progress", "delivered", "canceled"];
const METHODS = ["card", "cashapp", "zelle"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class UserError extends Error {}

const clean = (v: unknown, max = 500) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, max);

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/* ---------- current-site check (rebuild orders) ---------- */

function privateV4(ip: string) {
  const p = ip.split(".").map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] >= 224;
}

function normalizeUrl(raw: string) {
  const s = clean(raw, 300);
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
}

async function publicTarget(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UserError("That website address does not look right."); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new UserError("Only public website addresses are supported.");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") || h.includes(":")) {
    throw new UserError("Only public website addresses are supported.");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) throw new UserError("Enter a domain name, not an IP address.");
  try {
    const ips = await Deno.resolveDns(h, "A");
    if (ips.some(privateV4)) throw new UserError("Only public website addresses are supported.");
  } catch (e) {
    if (e instanceof UserError) throw e; // DNS lookup unavailable: hostname checks above still apply
  }
  return u;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function analyze(raw: string) {
  let u = await publicTarget(raw);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  let html = "";
  try {
    let r: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      r = await fetch(u, { signal: ac.signal, redirect: "manual", headers: { "User-Agent": "QUEENEE website check (hsw365media@gmail.com)" } });
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) { u = await publicTarget(new URL(loc, u).toString()); continue; }
      break;
    }
    if (!r || !r.ok) throw new Error("Website returned HTTP " + (r ? r.status : "error"));
    html = (await r.text()).slice(0, 1500000);
  } finally { clearTimeout(timer); }

  const title = strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").slice(0, 200);
  const metaTag = (html.match(/<meta\b[^>]*name=["']?description["']?[^>]*>/i) || [])[0] || "";
  const description = strip((metaTag.match(/content=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || []).slice(1).find(Boolean) || "").slice(0, 300);
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => strip(m[1]).slice(0, 120)).filter(Boolean).slice(0, 20);
  const links = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => strip(m[1]));
  const cta = links.filter((t) => /book|quote|contact|call|schedule|start|buy|shop|appointment|listen|stream|tickets|merch|subscribe/i.test(t)).length;
  const mobile = /<meta\b[^>]*name=["']?viewport/i.test(html);
  const findings: string[] = [];
  if (!title) findings.push("No page title.");
  if (!description) findings.push("No search description.");
  if (!mobile) findings.push("Not set up for phones.");
  if (u.protocol !== "https:") findings.push("Not served over HTTPS.");
  if (headings.length < 3) findings.push("Thin page structure.");
  if (cta === 0) findings.push("No clear call to action.");
  return {
    url: u.toString(), domain: u.hostname.replace(/^www\./, ""), title, description, headings,
    links: links.length, cta, images: (html.match(/<img\b/gi) || []).length, forms: (html.match(/<form\b/gi) || []).length,
    mobile, https: u.protocol === "https:", findings,
  };
}

/* ---------- actions ---------- */

function newId() {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return "Q-" + [...b].map((x) => x.toString(36).padStart(2, "0")).join("").toUpperCase().slice(0, 7);
}

async function createOrder(body: Record<string, unknown>, req: Request) {
  if (clean(body.company_website)) return { id: "Q-0000000", token: "x", amountDue: 0, comp: false, payment: null }; // bot trap

  const name = clean(body.name, 120), email = clean(body.email, 160).toLowerCase(), project = clean(body.projectName, 160);
  if (!name || !email || !project) throw new UserError("Your name, email and the name for the site are required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Enter a valid email address.");

  const clientType = ["artist", "business", "other"].includes(String(body.clientType)) ? String(body.clientType) : "business";
  const siteType = body.siteType === "rebuild" ? "rebuild" : "new";
  const plan = body.plan === "bundle" ? "bundle" : "website";
  const currentUrl = siteType === "rebuild" ? normalizeUrl(String(body.currentUrl || "")) : "";
  if (siteType === "rebuild" && !currentUrl) throw new UserError('Enter your current website address, or choose "I need a new website".');

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const ipHash = (await sha256("queenee:" + ip)).slice(0, 32);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await db(`queenee_orders?select=id&ip_hash=eq.${ipHash}&created_at=gte.${since}`);
  if (recent.length >= 6) throw new UserError("Too many sign-ups from this connection. Email hsw365media@gmail.com and we will get you started.");

  let analysis: unknown = null;
  if (currentUrl) {
    try { analysis = await analyze(currentUrl); }
    catch (e) { if (e instanceof UserError) throw e; analysis = { url: currentUrl, error: String((e as Error).message || e).slice(0, 200) }; }
  }

  const comp = OWNER_EMAILS.includes(email);
  const amountDue = comp ? 0 : PRICES.website + (plan === "bundle" ? PRICES.addon : 0);
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const row = {
    id: newId(), token, status: comp ? "paid" : "new", client_type: clientType, site_type: siteType, plan,
    amount_due: amountDue, comp, name, email, phone: clean(body.phone, 40) || null, project_name: project,
    category: clean(body.category, 160) || null, location: clean(body.location, 160) || null,
    links: clean(body.links, 1000) || null, current_url: currentUrl || null, goal: clean(body.goal, 500) || null,
    notes: clean(body.notes, 2000) || null, analysis, ip_hash: ipHash, user_agent: clean(req.headers.get("user-agent"), 300) || null,
  };
  await db("queenee_orders", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
  return { id: row.id, token, amountDue, comp, plan, payment: comp ? null : await paymentSettings(), prices: PRICES };
}

async function recordPayment(body: Record<string, unknown>) {
  const id = clean(body.id, 20), token = clean(body.token, 64), method = String(body.method);
  if (!METHODS.includes(method)) throw new UserError("Choose card, Cash App or Zelle.");
  const rows = await db(`queenee_orders?select=id,token,status&id=eq.${encodeURIComponent(id)}`);
  if (!rows.length || !safeEqual(rows[0].token, token)) throw new UserError("We could not find that order.");
  const cur = rows[0].status;
  const next = body.reported ? "payment_reported" : "checkout_started";
  const patch: Record<string, unknown> = { pay_method: method, updated_at: new Date().toISOString() };
  if (cur === "new" || (cur === "checkout_started" && next === "payment_reported")) patch.status = next;
  await db(`queenee_orders?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  return { ok: true, status: patch.status || cur };
}

async function requireAdmin(body: Record<string, unknown>) {
  const key = clean(body.key, 200);
  if (!key || !safeEqual(await sha256(key), ADMIN_HASH)) throw Object.assign(new UserError("Wrong owner key."), { status: 401 });
}

async function adminList(body: Record<string, unknown>) {
  await requireAdmin(body);
  const rows = await db("queenee_orders?select=*&order=created_at.desc&limit=500");
  return { orders: rows.map(({ token: _t, ip_hash: _i, ...r }: Record<string, unknown>) => r) };
}

async function adminUpdate(body: Record<string, unknown>) {
  await requireAdmin(body);
  const status = String(body.status);
  if (!STATUSES.includes(status)) throw new UserError("Unknown status.");
  const rows = await db(`queenee_orders?id=eq.${encodeURIComponent(clean(body.id, 20))}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  });
  if (!rows.length) throw new UserError("Order not found.");
  return { ok: true, status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET") return json({ ok: true, service: "QUEENEE", prices: PRICES });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "order": return json(await createOrder(body, req), 201);
      case "pay": return json(await recordPayment(body));
      case "admin_list": return json(await adminList(body));
      case "admin_update": return json(await adminUpdate(body));
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, (e as { status?: number }).status || 400);
    console.error("queenee error", e);
    return json({ error: "Something went wrong saving that. Try again, or email hsw365media@gmail.com." }, 500);
  }
});
