// Client for CallTwin's partner provisioning API (HSW365/calltwin backend/routes/partner.js).
function createCallTwin({ baseUrl = process.env.CALLTWIN_API_URL || 'https://calltwin.onrender.com', key = process.env.CALLTWIN_PARTNER_KEY || '' } = {}) {
  const configured = Boolean(baseUrl && key);
  async function upsert(account) {
    if (!configured) return { ok: false, skipped: true, error: 'CALLTWIN_PARTNER_KEY not configured' };
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await fetch(baseUrl.replace(/\/$/, '') + '/api/partner/accounts', {
        method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', 'x-partner-key': key },
        body: JSON.stringify({ source: 'queenee', ...account })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: data.error || 'CallTwin HTTP ' + r.status };
      return { ok: true, ...data };
    } catch (e) {
      return { ok: false, error: e.name === 'AbortError' ? 'CallTwin timed out (service may be waking up)' : e.message };
    } finally { clearTimeout(t); }
  }
  return { configured, upsert, dashboardUrl: process.env.CALLTWIN_DASHBOARD_URL || baseUrl };
}
module.exports = { createCallTwin };
