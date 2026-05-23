const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && req.headers['x-vercel-cron'] !== '1') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of (newLeads || [])) {
      const createdAt = new Date(lead.created_at);
      const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60);

      if (hoursSinceCreated >= 24) {
        await db.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
        continue;
      }

      if (hoursSinceCreated >= 2) {
        const { data: recentOut } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        const market = detectMarket(lead.phone);
        const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';

        await sendTemplate(lead.phone, templateName, {
          name: lead.name || 'there',
          templateParams: [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html'
          ]
        });
        nudged++;
      }
    }

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    for (const lead of (droppedLeads || [])) {
      const { data: recentNudge } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_dropped')
        .limit(1);

      if (recentNudge && recentNudge.length > 0) continue;

      const market = detectMarket(lead.phone);
      const templateName = isHinglish(market) ? 'reengage_dropped_hi' : 'reengage_dropped';

      await sendTemplate(lead.phone, templateName, {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });
      reengaged++;
    }

    return res.status(200).json({
      message: 'Nudge cron completed',
      nudged,
      dropped,
      reengaged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
