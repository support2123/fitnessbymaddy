const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients, error } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1)
        .single();

      if (existingCheckin) {
        results.push({ clientId: client.id, status: 'already_submitted' });
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = new Set((missedCheckins || []).map(c => c.week_no));
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 3); w--) {
        if (!submittedWeeks.has(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 Missed Check-ins',
          `Client: ${client.name}, Phone: ${client.phone.slice(0, 3)}XXX...${client.phone.slice(-3)}, Missed: ${consecutiveMissed} weeks`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name,
        templateParams: [
          client.name || 'there',
          currentWeek.toString(),
          checkinUrl
        ]
      }, true);

      results.push({ clientId: client.id, week: currentWeek, status: 'sent' });
    }

    return res.status(200).json({ ok: true, processed: results.length, results });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
