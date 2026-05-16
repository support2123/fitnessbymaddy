const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['x-vercel-cron'];
  const authHeader = req.headers.authorization || '';
  if (!cronSecret && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge leads who haven't replied in 2 hours (push trial)
    const { data: staleNew } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    for (const lead of (staleNew || [])) {
      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of (deadLeads || [])) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // Re-engage dropped leads from 7 days ago (one last attempt)
    const sevenDaysWindow = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', sevenDaysWindow);

    let reengaged = 0;
    for (const lead of (reengageLeads || [])) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (!msgs || msgs.length === 0) {
        await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
        reengaged++;
      }
    }

    // Nudge active clients who haven't submitted this week's check-in
    const { data: pendingClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    for (const client of (pendingClients || [])) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil(
        (Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      if (weekNo < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        const daysSinceSunday = new Date().getDay();
        if (daysSinceSunday >= 1 && daysSinceSunday <= 2) {
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'Champion',
            String(weekNo)
          ]);
          clientNudged++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      reengaged,
      clientNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
