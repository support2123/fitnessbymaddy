const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of (staleLeads || [])) {
      const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastMsg >= 24 && hoursSinceLastMsg < 48) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
        ]);
        nudged++;
      } else if (hoursSinceLastMsg >= 48) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const { data: qualifiedStale } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    for (const lead of (qualifiedStale || [])) {
      const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastMsg >= 48 && hoursSinceLastMsg < 72) {
        const market = detectMarket(lead.phone);
        if (isHinglishMarket(market)) {
          await sendTemplate(lead.phone, 'nudge_qualified_hi', [
            lead.name || 'there',
          ]);
        } else {
          await sendTemplate(lead.phone, 'nudge_qualified_en', [
            lead.name || 'there',
          ]);
        }
        nudged++;
      } else if (hoursSinceLastMsg >= 168) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
