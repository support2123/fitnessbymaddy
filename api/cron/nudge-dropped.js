const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge leads with no reply after 2 hours (still status=new)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of staleNewLeads || []) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial');

      if ((count || 0) === 0) {
        await sendWhatsApp(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      }
    }

    // Mark leads with no reply after 24 hours as dropped
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    if (expiredLeads?.length) {
      const ids = expiredLeads.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    // Re-engage dropped leads after 7 days (one-time)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reengaged = 0;
    for (const lead of reengageLeads || []) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day');

      if ((count || 0) === 0) {
        await sendWhatsApp(lead.phone, 'reengage_7day', [lead.name || 'there']);
        reengaged++;
      }
    }

    // Nudge clients with pending check-ins (+24h and +48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);
      const dayOfWeek = now.getDay();

      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (!checkin) {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp(client.phone, 'checkin_reminder', [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ]);
        clientNudged++;
      }
    }

    return res.json({
      success: true,
      nudged,
      dropped,
      reengaged,
      clientNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
