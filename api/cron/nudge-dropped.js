const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}` ||
                   authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lte('last_msg_at', oneDayAgo)
      .gte('created_at', sevenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of newLeads) {
      const { data: existingNudge } = await db
        .from('nudges')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('type', 'trial_nudge')
        .maybeSingle();

      if (existingNudge) continue;

      const market = lead.market || detectMarket(lead.phone);

      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
        ]);
      } else {
        await sendTemplate(lead.phone, 'nudge_trial_en', [
          lead.name || 'there',
        ]);
      }

      await db.from('nudges').insert({
        lead_id: lead.id,
        type: 'trial_nudge',
      });

      nudged++;
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    return res.status(200).json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
