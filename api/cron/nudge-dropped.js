const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ ok: true, message: 'No leads to nudge', nudged: 0 });
    }

    const { data: alreadyNudged } = await db
      .from('messages')
      .select('phone')
      .eq('template_name', 'reengagement_nudge')
      .gte('sent_at', fourteenDaysAgo);

    const nudgedPhones = new Set((alreadyNudged || []).map(m => m.phone));

    let nudged = 0;

    for (const lead of droppedLeads) {
      if (nudgedPhones.has(lead.phone)) continue;

      const hinglish = lead.market === 'IN';
      const templateName = hinglish ? 'reengagement_nudge_hi' : 'reengagement_nudge_en';

      await sendWhatsApp({
        phone: lead.phone,
        templateName,
        bodyValues: [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/shred.html',
        ],
      });

      nudged++;
      console.log(`Re-engagement nudge: ${maskPhone(lead.phone)}`);
    }

    return res.json({ ok: true, total_dropped: droppedLeads.length, nudged });

  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
