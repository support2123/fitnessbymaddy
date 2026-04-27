const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/market');
const { maskPhone } = require('../_lib/pii');

const NUDGE_WINDOW_DAYS = 7;
const NUDGE_COOLDOWN_DAYS = 30;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', thirtyDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      try {
        const { data: recentMsg } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (recentMsg) {
          const lastSent = new Date(recentMsg.sent_at);
          const daysSince = (Date.now() - lastSent.getTime()) / (24 * 60 * 60 * 1000);
          if (daysSince < NUDGE_WINDOW_DAYS) continue;
        }

        const { market } = detectMarket(lead.phone);
        const lang = market === 'IN' ? 'hi' : 'en';
        const template = lang === 'hi' ? 'nudge_trial_hi' : 'nudge_trial';

        await sendTemplate(lead.phone, template, [
          lead.name || 'there',
          '$20',
          'https://fitnessbymaddy.com/shred.html',
        ]);

        sent++;
        console.log(`Nudge sent: ${maskPhone(lead.phone)}`);

      } catch (err) {
        console.error(`Nudge error for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    return res.status(200).json({
      success: true,
      total_dropped: droppedLeads.length,
      sent,
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
