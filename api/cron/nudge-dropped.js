const { supabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge leads with no reply after 2 hours (still status=new)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .is('nudge_sent_at', null);

    let nudged = 0;
    for (const lead of (staleNew || [])) {
      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });

      await supabase
        .from('leads')
        .update({ nudge_sent_at: now.toISOString() })
        .eq('id', lead.id);

      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleDrop } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .not('nudge_sent_at', 'is', null);

    let dropped = 0;
    for (const lead of (staleDrop || [])) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
    }

    // Nudge active clients who missed check-in (24hrs after check-in window)
    const { data: missedClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    for (const client of (missedClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);
      const dayOfWeek = now.getDay();

      // Only nudge Mon-Tue (day after Sunday check-in window)
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!existing) {
        await sendWhatsApp(client.phone, 'checkin_reminder', {
          name: client.name || 'there',
          templateParams: [client.name || 'there', String(weekNo)]
        });
        clientNudged++;

        // Check for 2 consecutive missed check-ins → escalate
        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 1)
          .single();

        if (!prevCheckin) {
          const { escalateToMaddy } = require('../../lib/escalation');
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: client.phone,
            message: `${client.name} missed Week ${weekNo - 1} and Week ${weekNo}`
          });
        }
      }
    }

    return res.status(200).json({ nudged, dropped, clientNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
