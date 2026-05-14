const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { maskPhone } = require('../_lib/mask');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo);

      if (recentMessages && recentMessages.length > 0) continue;

      const hinglish = isHinglish(lead.market);

      if (hinglish) {
        await sendTemplate(lead.phone, 'win_back_hi', [
          lead.name || 'there',
          'https://fitnessbymaddy.com'
        ]);
      } else {
        await sendTemplate(lead.phone, 'win_back_en', [
          lead.name || 'there',
          'https://fitnessbymaddy.com'
        ]);
      }

      nudged++;
      console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
    }

    return res.status(200).json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Nudge cron failed' });
  }
};
