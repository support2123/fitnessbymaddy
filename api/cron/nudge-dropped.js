const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, checkRateLimit } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    let nudged = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const canSend = await checkRateLimit(lead.phone);
        if (!canSend) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo);

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: qualifiedStale } = await db
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    let qualifiedNudged = 0;
    if (qualifiedStale) {
      for (const lead of qualifiedStale) {
        const canSend = await checkRateLimit(lead.phone);
        if (!canSend) continue;

        await sendTemplate(lead.phone, 'nudge_checkout', [lead.name || 'there']);
        qualifiedNudged++;
      }
    }

    return res.json({
      nudged,
      dropped,
      qualifiedNudged,
      message: 'Nudge cron completed'
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
