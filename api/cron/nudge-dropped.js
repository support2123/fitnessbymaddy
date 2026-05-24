const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, escalateToMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();

    // Nudge new leads who haven't replied after 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of (staleNewLeads || [])) {
      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]
      });
      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    if (expiredLeads && expiredLeads.length > 0) {
      const ids = expiredLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    // Check for clients with 2+ consecutive missed check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let escalated = 0;
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSince / 7);

      if (currentWeek < 3) continue;

      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .in('week_no', [currentWeek - 1, currentWeek - 2]);

      if (!recentCheckins || recentCheckins.length === 0) {
        await escalateToMaddy(
          client.phone,
          `${client.name} has missed 2 consecutive check-ins (weeks ${currentWeek - 2} and ${currentWeek - 1})`,
          '2 consecutive missed check-ins'
        );
        escalated++;
      }
    }

    // Nudge clients who haven't submitted this week's check-in (+24h, +48h)
    let checkinNudged = 0;
    const sunday = new Date(now);
    sunday.setHours(3, 30, 0, 0); // 9am IST = 3:30 UTC
    const hoursSinceSunday = (now - sunday) / (1000 * 60 * 60);

    if ((hoursSinceSunday >= 24 && hoursSinceSunday < 25) ||
        (hoursSinceSunday >= 48 && hoursSinceSunday < 49)) {
      for (const client of (activeClients || [])) {
        const startDate = new Date(client.program_started_at);
        const daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSince / 7);

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (!existing) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendWhatsApp(client.phone, 'checkin_reminder', {
            name: client.name,
            templateParams: [client.name, checkinUrl]
          });
          checkinNudged++;
        }
      }
    }

    return res.status(200).json({ nudged, dropped, escalated, checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
