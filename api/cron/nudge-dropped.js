const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, getNudgeMessage } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, market, last_msg_at')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads?.length) {
      return res.status(200).json({ message: 'No leads to nudge', count: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentOut } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      const market = lead.market || detectMarket(lead.phone);
      const msg = getNudgeMessage(market);

      await sendWhatsApp(lead.phone, msg, 'nudge_reengagement');
      nudged++;
    }

    return res.status(200).json({
      success: true,
      total_dropped: droppedLeads.length,
      nudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
