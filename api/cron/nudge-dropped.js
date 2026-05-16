const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString())
      .gt('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of (staleLeads || [])) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial');

      if (msgs && msgs.length > 0) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
      });
      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { data: deadLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo.toISOString());

    let dropped = 0;
    for (const lead of (deadLeads || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (!replies || replies.length <= 1) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Nudge clients with pending check-ins (24hr + 48hr)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        const sundayIST = new Date(now);
        sundayIST.setUTCHours(3, 30, 0, 0);
        while (sundayIST.getUTCDay() !== 0) {
          sundayIST.setDate(sundayIST.getDate() - 1);
        }

        const hoursSinceSunday = (now - sundayIST) / (60 * 60 * 1000);

        if (hoursSinceSunday >= 24 && hoursSinceSunday < 48) {
          await sendWhatsApp(client.phone, 'checkin_reminder', {
            name: client.name || 'there',
            templateParams: [client.name || 'there', weekNo.toString()]
          });
          checkinNudges++;
        } else if (hoursSinceSunday >= 48) {
          await sendWhatsApp(client.phone, 'checkin_urgent', {
            name: client.name || 'there',
            templateParams: [client.name || 'there', weekNo.toString()]
          });
          checkinNudges++;

          // 2 consecutive missed check-ins → escalate
          const { data: prevCheckin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo - 1)
            .single();

          if (!prevCheckin) {
            await notifyMaddy(
              '2 missed check-ins',
              `${client.name || client.phone} missed weeks ${weekNo - 1} & ${weekNo}`
            );
          }
        }
      }
    }

    return res.status(200).json({ nudged, dropped, checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
