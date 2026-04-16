// Cron: Sun 09:00 IST (03:30 UTC) — sends weekly check-in links to active clients.
// Week number = ceil((now - started) / 7 days), capped at program length.

import { db } from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { copyFor, detectMarket } from '../../lib/lang.js';
import { checkinUrl } from '../../lib/routing.js';
import { json, isCronRequest, requireAdmin } from '../../lib/http.js';
import { maskPhone } from '../../lib/pii.js';

export default async function handler(req, res) {
  if (!isCronRequest(req) && !requireAdmin(req)) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const sb = db();
  const { data: clients, error } = await sb
    .from('clients')
    .select('id, phone, name, program, program_started_at, program_ends_at')
    .eq('status', 'active');

  if (error) return json(res, 500, { error: error.message });

  const results = [];
  const now = Date.now();

  for (const c of clients || []) {
    if (!c.program_started_at) continue;
    const startedMs = new Date(c.program_started_at).getTime();
    const endedMs = c.program_ends_at ? new Date(c.program_ends_at).getTime() : null;
    if (endedMs && now > endedMs) continue;

    const week = Math.max(1, Math.ceil((now - startedMs) / (7 * 24 * 60 * 60 * 1000)));
    const link = checkinUrl(c.id, week);
    const market = detectMarket(c.phone);

    const { ok } = await sendWhatsApp({
      phone: c.phone,
      body: copyFor('checkin_invite', market, { week, link }),
      templateName: 'checkin_invite',
      campaignName: `checkin_week_${week}`,
      params: [String(week), link]
    });

    results.push({ phone: maskPhone(c.phone), week, ok });
  }

  return json(res, 200, { ok: true, sent: results.length, results });
}
