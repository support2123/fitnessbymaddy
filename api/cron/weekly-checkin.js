const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin && existingCheckin.form_submitted_at) {
        continue;
      }

      const { data: lastTwoCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwoCheckins && lastTwoCheckins.length >= 2) {
        const expected = currentWeek - 1;
        const missed = lastTwoCheckins.every(c => c.week_no < expected - 1);
        if (missed) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            client.phone,
            `Client ${client.name} missed weeks ${currentWeek - 2} and ${currentWeek - 1}`
          );
          escalated++;
        }
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl
      ]);
      sent++;
    }

    return res.status(200).json({
      success: true,
      sent,
      nudged,
      escalated,
      total_clients: activeClients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
