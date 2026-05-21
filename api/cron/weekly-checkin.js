const { supabase } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    let sent = 0;
    let missed2 = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoMissed = weekNo >= 3
        && !submittedWeeks.includes(weekNo - 1)
        && !submittedWeeks.includes(weekNo - 2);

      if (lastTwoMissed) {
        missed2++;
        await notifyMaddy('2 consecutive missed check-ins',
          `Client: ${client.name || 'Unknown'} (${client.program})\nLast submitted: Week ${submittedWeeks[0] || 'none'}`
        );
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendText(client.phone,
        `Hi ${client.name || 'there'}! It's check-in time (Week ${weekNo}).\n\n` +
        `Fill out your weekly progress here:\n${checkinUrl}\n\n` +
        `Include your weight, waist measurement, and progress photos. Let's see those gains!`
      );
      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated_missed: missed2 });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
