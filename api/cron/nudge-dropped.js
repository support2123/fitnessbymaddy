const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!reEngageLeads || reEngageLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to re-engage' });
    }

    const results = [];

    for (const lead of reEngageLeads) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) {
        results.push({ phone: '***', status: 'rate_limited' });
        continue;
      }

      const hinglish = lead.market === 'IN';

      await sendTemplate(lead.phone, 'reengage_7day', [
        lead.name || 'there',
        hinglish
          ? 'Abhi bhi interested ho fitness mein? Maddy ka $20 trial lelo — sirf 1 Zoom session mein pata chalega!'
          : 'Still thinking about your fitness goals? Try Maddy\'s $20 Zoom trial — just one session to see the difference!',
      ]);

      results.push({ phone: '***', status: 'sent' });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('last_msg_at', fourteenDaysAgo);

    return res.status(200).json({ re_engaged: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
