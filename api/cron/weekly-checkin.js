const { supabase } = require('../../lib/supabase');
const { sendTemplate, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    const results = [];

    for (const client of (activeClients || [])) {
      const programStart = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - programStart) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) {
        results.push({ client_id: client.id, status: 'already_submitted' });
        continue;
      }

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      const consecutiveMissed = currentWeek > 2 ? (2 - (missedCount || 0)) : 0;
      if (consecutiveMissed >= 2) {
        await sendTemplate('+917082478374', 'escalation_alert', [
          'missed_checkins',
          `${client.name || maskPhone(client.phone)} missed 2 consecutive check-ins`,
          'Review required',
        ]);
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl,
      ]);

      results.push({
        client_id: client.id,
        week: currentWeek,
        status: 'sent',
      });
    }

    return res.status(200).json({
      ok: true,
      processed: results.length,
      results,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
