import { getSupabase } from '../_lib/supabase.js';
import { sendTemplate, maskPhone } from '../_lib/whatsapp.js';
import { getNudge } from '../_lib/market.js';

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!leads?.length) {
      return res.status(200).json({ ok: true, message: 'No leads to nudge' });
    }

    let sent = 0;

    for (const lead of leads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reactivate');

      if ((count || 0) > 0) continue;

      try {
        await sendTemplate(lead.phone, 'nudge_reactivate', [
          lead.name || 'there'
        ]);
        sent++;
        console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
      } catch (err) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    return res.status(200).json({ ok: true, sent, total: leads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
