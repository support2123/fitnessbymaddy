const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (staleNewLeads && staleNewLeads.length > 0) {
      for (const lead of staleNewLeads) {
        const hoursSinceLastMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
          continue;
        }

        const market = lead.market || detectMarket(lead.phone);
        if (isHinglish(market)) {
          await sendTemplate(lead.phone, 'nudge_trial_hinglish', [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html'
          ]);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_english', [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html'
          ]);
        }
        nudged++;
      }
    }

    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredNew } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', oneDayAgo);

    if (expiredNew && expiredNew.length > 0) {
      const ids = expiredNew.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped += ids.length;
    }

    return res.status(200).json({ ok: true, nudged, dropped });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
