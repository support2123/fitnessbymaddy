const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../_lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;
const COOLDOWN_DAYS = 30;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0, errors: 0 };

  try {
    const windowStart = new Date(Date.now() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', cooldownCutoff)
      .lte('last_msg_at', windowStart);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', results });
    }

    for (const lead of droppedLeads) {
      try {
        const { data: recentOutbound } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (recentOutbound && recentOutbound.length > 0) {
          results.skipped++;
          continue;
        }

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);
        const trialUrl = 'https://www.fitnessbymaddy.com/intake.html?program=zoom_trial';

        const params = hinglish
          ? [lead.name || 'there', trialUrl]
          : [lead.name || 'there', trialUrl];

        await sendTemplate(lead.phone, 'nudge_trial', params, false);
        results.nudged++;

        console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
      } catch (leadErr) {
        console.error(`Nudge error for ${maskPhone(lead.phone)}: ${leadErr.message}`);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error(`Nudge cron error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};
