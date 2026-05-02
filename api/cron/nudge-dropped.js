const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead, maskPhone } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;
const COOLDOWN_DAYS = 30;

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0, errors: 0 };

  try {
    const reengageAfter = new Date(Date.now() - REENGAGEMENT_WINDOW_DAYS * 86400000).toISOString();
    const cooldownBefore = new Date(Date.now() - COOLDOWN_DAYS * 86400000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', cooldownBefore)
      .lte('last_msg_at', reengageAfter);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', ...results });
    }

    for (const lead of leads) {
      try {
        const allowed = await canSendToLead(lead.phone);
        if (!allowed) { results.skipped++; continue; }

        const hinglish = isHinglish(lead.market);
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        results.nudged++;
      } catch (err) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
