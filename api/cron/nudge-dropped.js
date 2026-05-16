const { supabase } = require('../../lib/supabase');
const { sendRateLimited } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - REENGAGEMENT_WINDOW_DAYS);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo.toISOString())
      .order('last_msg_at', { ascending: true });

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to re-engage', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const lead of droppedLeads) {
      try {
        const { data: reengageMsg } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_dropped')
          .limit(1)
          .maybeSingle();

        if (reengageMsg) continue;

        const market = detectMarket(lead.phone);
        const params = isHinglish(market)
          ? [lead.name || 'there', 'https://fitnessbymaddy.com/shred.html']
          : [lead.name || 'there', 'https://fitnessbymaddy.com/shred.html'];

        const result = await sendRateLimited(lead.phone, 'reengage_dropped', params);
        if (!result.skipped) sent++;
      } catch (leadErr) {
        errors.push({ leadId: lead.id, error: leadErr.message });
      }
    }

    return res.status(200).json({
      message: 'Nudge dropped cron complete',
      totalDropped: droppedLeads.length,
      sent,
      errors: errors.length,
    });
  } catch (err) {
    console.error('Nudge dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
