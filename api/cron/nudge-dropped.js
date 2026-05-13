const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

const REENGAGEMENT_WINDOW_DAYS = 7;
const NUDGE_COOLDOWN_DAYS = 3;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const cooldownCutoff = new Date(now.getTime() - NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

    const { data: droppedLeads } = await getSupabase()
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', windowStart.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await getSupabase()
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1);

      if (recentMsg?.[0]) {
        const lastSent = new Date(recentMsg[0].sent_at);
        if (lastSent > cooldownCutoff) continue;
      }

      const { data: inMessages } = await getSupabase()
        .from('messages')
        .select('body')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .order('sent_at', { ascending: false })
        .limit(1);

      const lastText = inMessages?.[0]?.body || '';
      if (/stop|unsubscribe|opt.?out/i.test(lastText)) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://fitnessbymaddy.com/shred.html'
      ], lead.name);

      nudged++;
    }

    return res.json({ nudged, checked: droppedLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
