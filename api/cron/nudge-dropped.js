const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;
const COOLDOWN_DAYS = 30;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', thirtyDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (error) throw error;
    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      const templateName = isHinglish(lead.market)
        ? 'nudge_trial'
        : 'nudge_trial_en';

      await sendTemplate(lead.phone, templateName, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/shred.html',
      ]);

      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: unresponsive } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (unresponsive && unresponsive.length > 0) {
      const ids = unresponsive.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
    }

    return res.status(200).json({
      ok: true,
      nudged,
      auto_dropped: unresponsive?.length || 0,
    });
  } catch (err) {
    console.error('[cron/nudge-dropped]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
