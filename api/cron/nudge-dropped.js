const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0, errors: 0 };

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const { data: leads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', fourteenDaysAgo);

  if (!leads || leads.length === 0) {
    return res.json({ message: 'No leads to nudge', ...results });
  }

  for (const lead of leads) {
    try {
      const canSend = await canSendToLead(lead.phone);
      if (!canSend) {
        results.skipped++;
        continue;
      }

      const market = detectMarket(lead.phone);
      const templateName = isHinglishMarket(market)
        ? 'nudge_trial_hi'
        : 'nudge_trial_en';

      await sendTemplate(lead.phone, templateName, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/shred.html'
      ]);

      await db.from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);

      results.nudged++;
    } catch (err) {
      console.error(`Nudge failed for ${maskPhone(lead.phone)}: ${err.message}`);
      results.errors++;
    }
  }

  console.log(`Nudge-dropped cron: ${JSON.stringify(results)}`);
  return res.json({ success: true, ...results });
};
