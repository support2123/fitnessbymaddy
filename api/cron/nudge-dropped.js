const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const NUDGE_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo)
      .lte('last_msg_at', oneDayAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_dropped')
        .order('sent_at', { ascending: false })
        .limit(1);

      if (recentMsg && recentMsg.length > 0) {
        const lastNudge = new Date(recentMsg[0].sent_at).getTime();
        if (Date.now() - lastNudge < 7 * 24 * 60 * 60 * 1000) {
          continue;
        }
      }

      const market = lead.market || detectMarket(lead.phone);
      if (isHinglish(market)) {
        await sendWhatsApp(lead.phone, 'nudge_dropped_hi', [
          lead.name || 'there',
        ]);
      } else {
        await sendWhatsApp(lead.phone, 'nudge_dropped_en', [
          lead.name || 'there',
        ]);
      }
      sent++;
    }

    return res.status(200).json({ message: 'Nudge complete', sent });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
