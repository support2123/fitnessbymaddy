const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (error) throw error;
    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const lead of leads) {
      try {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/shred.html'
        ]);

        sent++;
      } catch (leadErr) {
        console.error(`[Cron] Nudge failed for ${maskPhone(lead.phone)}:`, leadErr.message);
        errors.push({ phone: maskPhone(lead.phone), error: leadErr.message });
      }
    }

    return res.status(200).json({
      success: true,
      total_eligible: leads.length,
      sent,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('[Cron/NudgeDropped] Error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
