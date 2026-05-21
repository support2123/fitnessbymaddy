const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  let sent = 0;
  let errors = 0;
  const escalations = [];

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

        const endDate = new Date(client.program_ends_at);
        if (now > endDate) {
          await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
          continue;
        }

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (existing && existing.length > 0) continue;

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        let consecutiveMissed = 0;
        for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 3); w--) {
          if (!submittedWeeks.includes(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          escalations.push(client);
          await notifyMaddy(
            `2 missed check-ins: ${client.name || client.phone}`,
            `Client ${client.name} has missed ${consecutiveMissed} consecutive check-ins. Current week: ${currentWeek}`
          );
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ]);
        sent++;
      } catch (err) {
        errors++;
        console.error(`Error for client ${client.id}:`, err.message);
      }
    }

    return res.status(200).json({
      sent,
      errors,
      escalations: escalations.length,
      total_clients: activeClients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
