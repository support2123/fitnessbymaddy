import { supa } from '../_lib/supabase.js';
import { sendWhatsApp } from '../_lib/whatsapp.js';
import { render, TEMPLATES } from '../_lib/templates.js';
import { marketFromPhone } from '../_lib/market.js';
import { checkoutUrl } from '../_lib/router.js';
import { json } from '../_lib/http.js';

// Daily job. Two passes:
//  1) Nudge "new" leads with no reply at 2h and 24h since first_msg
//  2) Re-engage "dropped" leads once, ~7 days after drop (no stop keyword)
export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) return json(res, 401, { error: 'unauthorized' });

  const db = supa();
  const now = Date.now();
  const twoH = new Date(now - 2 * 3600 * 1000).toISOString();
  const oneD = new Date(now - 24 * 3600 * 1000).toISOString();
  const sevenD = new Date(now - 7 * 86400 * 1000).toISOString();
  const eightD = new Date(now - 8 * 86400 * 1000).toISOString();

  const result = { nudged_2h: 0, dropped: 0, reengaged: 0 };

  // 1) Leads stale > 2h but < 24h → nudge_trial; > 24h → drop
  const { data: stale2h } = await db.from('leads')
    .select('*').eq('status', 'new')
    .lt('last_msg_at', twoH).gt('last_msg_at', oneD);

  for (const l of stale2h || []) {
    const { lang } = marketFromPhone(l.phone);
    try {
      await sendWhatsApp({
        to: l.phone,
        templateName: TEMPLATES.nudge_trial.name,
        body: render('nudge_trial', lang, { url: checkoutUrl('zoom_trial') }),
        params: [checkoutUrl('zoom_trial')]
      });
      result.nudged_2h++;
    } catch (e) {
      console.error('nudge 2h failed', e.message);
    }
  }

  const { data: dead } = await db.from('leads')
    .select('id, phone').eq('status', 'new').lt('last_msg_at', oneD);
  if (dead?.length) {
    await db.from('leads').update({ status: 'dropped' })
      .in('id', dead.map(d => d.id));
    result.dropped = dead.length;
  }

  // 2) Re-engage dropped ~7 days later (7–8 day window, only those that never sent STOP)
  const { data: toRengage } = await db.from('leads')
    .select('id, phone').eq('status', 'dropped')
    .lt('last_msg_at', sevenD).gt('last_msg_at', eightD);

  for (const l of toRengage || []) {
    // Skip if opted out explicitly
    const { count } = await db.from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('phone', l.phone).eq('direction', 'in').ilike('body', '%stop%');
    if ((count || 0) > 0) continue;

    const { lang } = marketFromPhone(l.phone);
    try {
      await sendWhatsApp({
        to: l.phone,
        templateName: TEMPLATES.reengage_7d.name,
        body: render('reengage_7d', lang, { url: checkoutUrl('zoom_trial') }),
        params: [checkoutUrl('zoom_trial')],
        bypassRateLimit: true
      });
      result.reengaged++;
    } catch (e) {
      console.error('reengage failed', e.message);
    }
  }

  return json(res, 200, { ok: true, ...result });
}
