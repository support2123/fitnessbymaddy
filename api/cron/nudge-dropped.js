const { supabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge leads who haven't replied in 2 hours (new leads only)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    const results = [];

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]);
        results.push({ phone: maskPhone(lead.phone), action: 'nudge_sent' });
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (deadLeads) {
      for (const lead of deadLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        results.push({ phone: maskPhone(lead.phone), action: 'dropped' });
      }
    }

    // Nudge active clients with missing check-ins (+24h and +48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        // Sunday = 0 (checkin day), Monday = 1 (+24h), Tuesday = 2 (+48h)
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            checkinUrl
          ]);
          results.push({ phone: maskPhone(client.phone), action: 'checkin_nudge' });
        }

        // 2 consecutive missed check-ins → escalate
        if (currentWeek >= 2) {
          const { data: prevCheckin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', currentWeek - 1)
            .single();

          if (!prevCheckin && !checkin) {
            await notifyMaddy(
              '2 consecutive missed check-ins',
              `Client: ${client.name || maskPhone(client.phone)}, Week ${currentWeek}`
            );
            results.push({ phone: maskPhone(client.phone), action: 'escalated_missed_checkins' });
          }
        }
      }
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
