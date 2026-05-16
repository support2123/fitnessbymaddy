const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();

    // Nudge leads who haven't replied after 2 hours (still 'new')
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: msgCount } = await supabase
          .from('messages')
          .select('id', { count: 'exact' })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (!msgCount || msgCount.length === 0) {
          await sendWhatsApp(lead.phone, 'nudge_trial', {
            templateParams: [lead.name || 'there']
          });
          nudged++;
        }
      }
    }

    // Mark 24hr+ no-reply leads as dropped
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    // Nudge check-in reminders (+24hr, +48hr)
    const { data: pendingClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingClients) {
      for (const client of pendingClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin && daysSinceStart % 7 >= 1 && daysSinceStart % 7 <= 3) {
          await sendWhatsApp(client.phone, 'checkin_reminder', {
            templateParams: [client.name || 'there', String(weekNo)]
          });
          checkinNudges++;
        }
      }
    }

    // Escalate 2 consecutive missed check-ins
    if (pendingClients) {
      for (const client of pendingClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek >= 3) {
          const { data: recentCheckins } = await supabase
            .from('checkins')
            .select('week_no')
            .eq('client_id', client.id)
            .gte('week_no', currentWeek - 2)
            .lte('week_no', currentWeek - 1);

          if (!recentCheckins || recentCheckins.length === 0) {
            await sendWhatsApp(process.env.MADDY_PHONE, 'escalation_alert', {
              templateParams: [
                `${client.name} missed 2 consecutive check-ins`,
                `Client ID: ${client.id}, Current week: ${currentWeek}`
              ]
            });
          }
        }
      }
    }

    return res.status(200).json({ nudged, checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
