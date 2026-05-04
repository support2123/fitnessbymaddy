const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let sent = 0;
    let dropped = 0;

    // Nudge new leads who haven't replied in 2 hours
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
        await sendWhatsApp({
          phone: lead.phone,
          templateName: isHinglish(lead.market) ? 'nudge_trial' : 'nudge_trial_en',
          params: [lead.name || 'there', '$20', trialUrl]
        });
        sent++;
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    if (deadLeads) {
      for (const lead of deadLeads) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads once after 7 days (only if dropped within last 14 days)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const { data: reengage_msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengage_msgs && reengage_msgs.length > 0) continue;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: isHinglish(lead.market) ? 'reengage_7day' : 'reengage_7day_en',
          params: [lead.name || 'there']
        });
        reengaged++;
      }
    }

    return res.status(200).json({ sent, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
