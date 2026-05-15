const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    if (!staleLeads || staleLeads.length === 0) {
      return res.status(200).json({ action: 'no_stale_leads' });
    }

    const results = [];

    for (const lead of staleLeads) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', twoHoursAgo)
        .limit(1);

      if (recentMsg && recentMsg.length > 0) {
        results.push({ lead_id: lead.id, action: 'rate_limited' });
        continue;
      }

      const trialUrl = 'https://fitnessbymaddy.com/shred.html';

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        trialUrl
      ]);

      results.push({ lead_id: lead.id, action: 'nudged' });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo)
      .lt('created_at', sevenDaysAgo);

    if (deadLeads && deadLeads.length > 0) {
      const ids = deadLeads.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
    }

    return res.status(200).json({
      nudged: results.filter(r => r.action === 'nudged').length,
      dropped: deadLeads?.length || 0,
      results
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
