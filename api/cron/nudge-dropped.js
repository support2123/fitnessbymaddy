const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged: 0, skipped: 0 };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', sevenDaysAgo)
      .gte('created_at', fourteenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', results });
    }

    for (const lead of newLeads) {
      try {
        const { data: recentMessages } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_reengagement')
          .limit(1);

        if (recentMessages && recentMessages.length > 0) {
          results.skipped++;
          continue;
        }

        const market = detectMarket(lead.phone);
        const template = isHinglish(market)
          ? 'nudge_reengagement_hi'
          : 'nudge_reengagement';

        await sendWhatsApp(lead.phone, template, [
          lead.name || 'there',
        ]);

        results.nudged++;
      } catch (leadErr) {
        console.error(`Nudge error for lead ${lead.id}:`, leadErr.message);
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
