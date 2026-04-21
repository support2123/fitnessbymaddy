const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    const { data: recentMessages } = await supabase
      .from('messages')
      .select('phone')
      .eq('direction', 'out')
      .eq('template_name', 'reengagement_7d')
      .gte('sent_at', sevenDaysAgo.toISOString());

    const alreadyNudged = new Set((recentMessages || []).map((m) => m.phone));

    let nudged = 0;

    for (const lead of droppedLeads) {
      if (alreadyNudged.has(lead.phone)) continue;

      const hinglish = isHinglish(lead.market);
      const params = hinglish
        ? [lead.name || 'there', '$20 Zoom Trial se start karo — koi commitment nahi! 💪']
        : [lead.name || 'there', 'Start with a $20 Zoom Trial — zero commitment! 💪'];

      await sendWhatsApp(lead.phone, 'reengagement_7d', params);
      nudged++;

      console.log(`Re-engaged: ${maskPhone(lead.phone)}`);
    }

    return res.status(200).json({ ok: true, nudged });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
