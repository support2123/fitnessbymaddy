// Cron: Sunday 09:00 IST = 03:30 UTC. Sends check-in forms + stale-nudges.
// Configured in vercel.json: "30 3 * * 0"

import { db } from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { render } from '../../lib/templates.js';
import { detectMarket } from '../../lib/market.js';
import { checkinUrl } from '../../lib/routing.js';
import { escalate } from '../../lib/escalation.js';
import { json, gateCron } from '../../lib/http.js';

export default async function handler(req, res) {
  if (gateCron(req, res)) return;

  const now = Date.now();
  const DAY = 86400000;
  const results = { sent: 0, nudged: 0, escalations: 0 };

  const { data: clients } = await db()
    .from('clients').select('*').eq('status', 'active');

  for (const c of (clients || [])) {
    const startedAt = c.program_started_at ? new Date(c.program_started_at).getTime() : now;
    const weekNo = Math.floor((now - startedAt) / (7 * DAY)) + 1;
    if (weekNo < 1) continue;

    // Expire the program once done
    if (c.program_ends_at && new Date(c.program_ends_at).getTime() < now) {
      await db().from('clients').update({ status: 'completed' }).eq('id', c.id);
      continue;
    }

    const market = detectMarket(c.phone);
    const url = checkinUrl(c.id, weekNo);

    // Does a check-in row for this week exist yet?
    const { data: ci } = await db()
      .from('checkins').select('form_submitted_at')
      .eq('client_id', c.id).eq('week_no', weekNo).maybeSingle();

    if (!ci) {
      // First request for this week
      const t = render('checkin_request', market, { weekNo, url });
      const r = await sendWhatsApp({ phone: c.phone, body: t.body, templateName: t.name, force: true });
      if (r.sent) results.sent++;
      await db().from('checkins').insert({ client_id: c.id, week_no: weekNo });
    } else if (!ci.form_submitted_at) {
      // Already requested — escalate if 2 consecutive missed
      const { data: prev } = await db()
        .from('checkins').select('week_no, form_submitted_at')
        .eq('client_id', c.id).lt('week_no', weekNo)
        .order('week_no', { ascending: false }).limit(1);
      if (prev?.[0] && !prev[0].form_submitted_at) {
        await escalate({
          phone: c.phone, clientId: c.id, reason: 'missed_checkins_2wk',
          context: `missed weeks ${prev[0].week_no} & ${weekNo}`
        });
        results.escalations++;
      }
      // 24 / 48 hr nudges based on row age
      // (Sunday→Monday cron also runs daily via nudge-dropped, so we reuse.)
    }
  }

  return json(res, 200, { ok: true, ...results });
}
