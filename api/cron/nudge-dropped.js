const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged_new: 0, nudged_trial: 0, skipped: 0 };

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    for (const lead of newLeads || []) {
      try {
        const market = detectMarket(lead.phone);
        if (isHinglish(market)) {
          await sendTemplate(lead.phone, 'nudge_trial_hi', [
            lead.name || 'there',
          ]);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_en', [
            lead.name || 'there',
          ]);
        }
        results.nudged_trial++;
      } catch (err) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    for (const lead of staleLeads || []) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      results.skipped++;
    }

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo);

    for (const lead of droppedLeads || []) {
      const { data: recentMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(2);

      if (recentMessages && recentMessages.length >= 2) continue;

      try {
        const market = detectMarket(lead.phone);
        if (isHinglish(market)) {
          await sendTemplate(lead.phone, 'reengage_hi', [lead.name || 'there']);
        } else {
          await sendTemplate(lead.phone, 'reengage_en', [lead.name || 'there']);
        }
        results.nudged_new++;
      } catch (err) {
        console.error(`Re-engage failed for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    return res.status(200).json({ message: 'Nudge cron complete', ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
