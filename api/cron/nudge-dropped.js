const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['x-cron-secret'] || req.headers.authorization;
  if (process.env.CRON_SECRET && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await supabase.from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of (staleNew || [])) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const market = detectMarket(lead.phone);
      const tpl = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';
      await sendTemplate(lead.phone, tpl, [lead.name || 'there']);
      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: expired } = await supabase.from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    if (expired?.length) {
      const ids = expired.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    // Re-engage dropped leads within 7-day window (one attempt only)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase.from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo)
      .lt('created_at', threeDaysAgo);

    let reengaged = 0;
    for (const lead of (reengageLeads || [])) {
      const { data: msgs } = await supabase.from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_v1')
        .limit(1);

      if (msgs?.length) continue;

      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const market = detectMarket(lead.phone);
      const tpl = isHinglish(market) ? 'reengage_v1_hi' : 'reengage_v1';
      await sendTemplate(lead.phone, tpl, [lead.name || 'there']);
      reengaged++;
    }

    return res.status(200).json({ nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
