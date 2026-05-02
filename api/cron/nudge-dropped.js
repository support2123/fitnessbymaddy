const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge leads who haven't replied in 2 hours (but less than 24h)
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    for (const lead of (staleLeads || [])) {
      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
      });
      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let dropped = 0;
    if (deadLeads && deadLeads.length > 0) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', deadLeads.map(l => l.id));
      dropped = deadLeads.length;
    }

    // Re-engage dropped leads from exactly 7 days ago (one last shot)
    const sevenDaysAgoStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoEnd = new Date(sevenDaysAgoStart.getTime() + 24 * 60 * 60 * 1000);

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgoStart.toISOString())
      .lt('created_at', sevenDaysAgoEnd.toISOString());

    let reengaged = 0;
    for (const lead of (reengageLeads || [])) {
      await sendWhatsApp(lead.phone, 'reengage_7day', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });
      reengaged++;
    }

    return res.status(200).json({ nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
