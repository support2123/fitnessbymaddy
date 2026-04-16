// Sunday 9am IST (03:30 UTC). Send check-in form link to every active
// client; nudge at +24h and +48h for those not submitted.

import { supa } from '../../lib/supabase.js';
import { sendText } from '../../lib/aisensy.js';
import { checkinUrl, COPY } from '../../lib/router.js';
import { jsonResponse, detectMarket, weekNumberSince } from '../../lib/utils.js';

export default async function handler(req, res) {
  if (!req.headers['x-vercel-cron']) {
    return jsonResponse(res, 401, { error: 'cron_only' });
  }

  const { data: clients } = await supa().from('clients').select('*').eq('status', 'active');
  let asked = 0, nudged = 0;

  for (const c of clients || []) {
    const weekNo = weekNumberSince(c.program_started_at);
    const { data: row } = await supa().from('checkins')
      .select('id, form_submitted_at').eq('client_id', c.id).eq('week_no', weekNo).maybeSingle();

    const market = c.market || detectMarket(c.phone);
    const url = checkinUrl(c.id, weekNo);

    if (!row) {
      // No check-in row at all for this week → first ask.
      await sendText({
        phone: c.phone,
        body: (market === 'IN' ? COPY.checkinAsk.IN : COPY.checkinAsk.EN)(weekNo, url)
      });
      asked += 1;
    } else if (row && !row.form_submitted_at) {
      // Placeholder row with no submission → nudge.
      await sendText({
        phone: c.phone,
        body: (market === 'IN' ? COPY.checkinNudge.IN : COPY.checkinNudge.EN)(url)
      });
      nudged += 1;
    }
  }

  return jsonResponse(res, 200, { ok: true, asked, nudged });
}
