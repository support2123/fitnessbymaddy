const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, market, last_msg_at, created_at')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', thirtyDaysAgo);

    if (!droppedLeads?.length) {
      return res.status(200).json({ ok: true, message: 'No leads to nudge', count: 0 });
    }

    const { data: recentNudges } = await db
      .from('messages')
      .select('phone')
      .eq('direction', 'out')
      .eq('template_name', 'win_back')
      .gte('sent_at', sevenDaysAgo);

    const nudgedPhones = new Set((recentNudges || []).map(m => m.phone));

    let sentCount = 0;

    for (const lead of droppedLeads) {
      if (nudgedPhones.has(lead.phone)) continue;

      const hinglish = isHinglish(lead.market);
      const templateName = hinglish ? 'win_back_hi' : 'win_back';

      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      sentCount++;

      if (sentCount >= 50) break;
    }

    return res.status(200).json({ ok: true, nudged: sentCount, total_eligible: droppedLeads.length });

  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
