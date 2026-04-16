// Cron: daily 10:00 IST (04:30 UTC) — re-engage leads dropped / stale 7+ days.
// Only touches leads with status in (new, qualified) whose last_msg_at is older than 7 days
// and who have not already been re-engaged in the last 30 days.

import { db, logMessage } from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { copyFor, detectMarket } from '../../lib/lang.js';
import { json, isCronRequest, requireAdmin } from '../../lib/http.js';
import { maskPhone } from '../../lib/pii.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 50;

export default async function handler(req, res) {
  if (!isCronRequest(req) && !requireAdmin(req)) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const sb = db();
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const reengageFloor = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const { data: leads, error } = await sb
    .from('leads')
    .select('id, phone, name, status, last_msg_at, market')
    .in('status', ['new', 'qualified'])
    .lt('last_msg_at', cutoff)
    .order('last_msg_at', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) return json(res, 500, { error: error.message });

  let sent = 0;
  const results = [];
  for (const l of leads || []) {
    // Skip if we already re-engaged them in the last 30 days.
    const { data: recent } = await sb.from('messages')
      .select('id')
      .eq('phone', l.phone)
      .eq('template_name', 'nudge_dropped')
      .gte('sent_at', reengageFloor)
      .limit(1);
    if (recent && recent.length) continue;

    const market = l.market || detectMarket(l.phone);
    const { ok } = await sendWhatsApp({
      phone: l.phone,
      body: copyFor('nudge_dropped', market),
      templateName: 'nudge_dropped',
      campaignName: 'nudge_dropped',
      params: [l.name || 'there']
    });
    if (ok) sent++;
    results.push({ phone: maskPhone(l.phone), ok });
  }

  await logMessage({
    phone: 'system',
    direction: 'out',
    body: `nudge-dropped run: ${sent}/${results.length}`,
    template_name: 'cron_summary',
    status: 'ok'
  });

  return json(res, 200, { ok: true, sent, scanned: results.length });
}
