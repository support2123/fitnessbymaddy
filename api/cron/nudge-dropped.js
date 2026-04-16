// Daily cron. Two jobs:
//  1) 7-day re-engagement for dropped/stale leads (only once per lead).
//  2) 24h / 48h nudges for pending check-ins.

import { db } from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { render } from '../../lib/templates.js';
import { detectMarket } from '../../lib/market.js';
import { checkinUrl } from '../../lib/routing.js';
import { json, gateCron } from '../../lib/http.js';

const DAY = 86400000;
const HOUR = 3600000;

export default async function handler(req, res) {
  if (gateCron(req, res)) return;

  const now = Date.now();
  const out = { reengaged: 0, nudged24: 0, nudged48: 0, dropped: 0 };

  // ------ 1) Reengage leads dormant 7+ days that never qualified
  const sevenAgo = new Date(now - 7 * DAY).toISOString();
  const { data: stale } = await db()
    .from('leads').select('*')
    .in('status', ['new', 'qualified'])
    .lt('last_msg_at', sevenAgo)
    .limit(100);

  for (const l of (stale || [])) {
    // Has Maddy already sent the 7-day reengage message?
    const { data: prev } = await db()
      .from('messages').select('id')
      .eq('phone', l.phone).eq('template_name', 'reengage_7day')
      .limit(1);
    if (prev?.length) {
      // Already reengaged once — drop the lead permanently
      await db().from('leads').update({ status: 'dropped' }).eq('id', l.id);
      out.dropped++;
      continue;
    }
    const market = detectMarket(l.phone);
    const t = render('reengage_7day', market);
    const r = await sendWhatsApp({ phone: l.phone, body: t.body, templateName: t.name, force: true });
    if (r.sent) out.reengaged++;
  }

  // ------ 2) Check-in nudges. Find today's pending check-in rows for active clients.
  const { data: pending } = await db()
    .from('checkins').select('*, clients(phone, status, program)')
    .is('form_submitted_at', null)
    .gt('created_at', new Date(now - 3 * DAY).toISOString());

  for (const row of (pending || [])) {
    const c = row.clients;
    if (!c || c.status !== 'active') continue;
    const ageHr = (now - new Date(row.created_at).getTime()) / HOUR;
    const market = detectMarket(c.phone);
    const url = checkinUrl(row.client_id, row.week_no);

    // Use the messages audit to avoid duplicate nudges
    const { data: alreadyNudged } = await db()
      .from('messages').select('template_name, sent_at')
      .eq('phone', c.phone)
      .in('template_name', ['checkin_nudge_24h', 'checkin_nudge_48h'])
      .gt('sent_at', new Date(now - 3 * DAY).toISOString());
    const has24 = alreadyNudged?.some(m => m.template_name === 'checkin_nudge_24h');
    const has48 = alreadyNudged?.some(m => m.template_name === 'checkin_nudge_48h');

    if (ageHr >= 24 && ageHr < 48 && !has24) {
      const t = render('checkin_nudge_24h', market, { url });
      const r = await sendWhatsApp({ phone: c.phone, body: t.body, templateName: t.name, force: true });
      if (r.sent) out.nudged24++;
    } else if (ageHr >= 48 && !has48) {
      const t = render('checkin_nudge_48h', market, { url });
      const r = await sendWhatsApp({ phone: c.phone, body: t.body, templateName: t.name, force: true });
      if (r.sent) out.nudged48++;
    }
  }

  return json(res, 200, { ok: true, ...out });
}
