// Daily 10am IST. Two jobs:
//   1. 2-hour silent lead → send trial nudge.
//   2. 7-day dropped lead → one re-engagement attempt, then stop.
// Also marks 24-hour silent leads as dropped.

import { supa } from '../../lib/supabase.js';
import { sendTemplate, sendText } from '../../lib/aisensy.js';
import { COPY, checkoutUrl } from '../../lib/router.js';
import { canSend } from '../../lib/rate-limit.js';
import { jsonResponse, detectMarket } from '../../lib/utils.js';

export default async function handler(req, res) {
  if (!req.headers['x-vercel-cron']) {
    return jsonResponse(res, 401, { error: 'cron_only' });
  }

  const now = Date.now();
  const twoHrsAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const dayAgo   = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo  = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: silent2h }, { data: silent24h }, { data: dropped7d }] = await Promise.all([
    supa().from('leads').select('*').eq('status', 'new')
      .lt('last_msg_at', twoHrsAgo).gte('last_msg_at', dayAgo),
    supa().from('leads').select('*').eq('status', 'new').lt('last_msg_at', dayAgo),
    supa().from('leads').select('*').eq('status', 'dropped')
      .lt('last_msg_at', weekAgo).gte('last_msg_at', eightDaysAgo)
  ]);

  let nudged = 0, droppedCount = 0, reengaged = 0;

  for (const l of silent2h || []) {
    if (!await canSend({ phone: l.phone })) continue;
    const market = l.market || detectMarket(l.phone);
    await sendTemplate({
      phone: l.phone,
      template: process.env.AISENSY_CAMPAIGN_NUDGE || 'nudge_trial',
      params: [l.name || 'there'],
      body: (market === 'IN' ? COPY.nudgeTrial.IN : COPY.nudgeTrial.EN) + checkoutUrl('zoom-trial')
    });
    nudged += 1;
  }

  for (const l of silent24h || []) {
    await supa().from('leads').update({ status: 'dropped' }).eq('id', l.id);
    droppedCount += 1;
  }

  for (const l of dropped7d || []) {
    if (!await canSend({ phone: l.phone })) continue;
    const market = l.market || detectMarket(l.phone);
    await sendText({
      phone: l.phone,
      body: market === 'IN'
        ? `Hi ${l.name || ''} 👋 Ek hafta ho gaya. Agar ab bhi goal reach karna hai — trial: ${checkoutUrl('zoom-trial')}`
        : `Hi ${l.name || ''} — it's been a week. If you still want to hit that goal, a trial is here: ${checkoutUrl('zoom-trial')}`
    });
    reengaged += 1;
  }

  return jsonResponse(res, 200, { ok: true, nudged, droppedCount, reengaged });
}
