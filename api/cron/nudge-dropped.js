const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ status: 'ok', message: 'No leads to nudge' });
    }

    const { data: recentNudges } = await db
      .from('messages')
      .select('phone')
      .eq('template_name', 'reengagement_v1')
      .gte('sent_at', sevenDaysAgo);

    const nudgedPhones = new Set((recentNudges || []).map(n => n.phone));
    const results = [];

    for (const lead of droppedLeads) {
      if (nudgedPhones.has(lead.phone)) {
        results.push({ phone_masked: lead.phone.slice(0, 3) + '***', status: 'already_nudged' });
        continue;
      }

      const market = lead.market || 'GLOBAL';
      const params = market === 'IN'
        ? ['Hey! Maddy ke $20 trial session se start karo — koi commitment nahi. Interested?']
        : ['Hey! Start with Maddy\'s $20 trial session — no commitment needed. Interested?'];

      await sendTemplate(lead.phone, 'reengagement_v1', params);

      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead.id);

      results.push({ phone_masked: lead.phone.slice(0, 3) + '***', status: 'nudged' });
    }

    return res.status(200).json({ status: 'ok', results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
