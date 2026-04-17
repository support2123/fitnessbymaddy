const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, notifyMaddy } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const { data: missedWeeks } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (missedWeeks || []).map(c => c.week_no);
        let consecutiveMissed = 0;
        for (let w = weekNo - 1; w >= Math.max(1, weekNo - 2); w--) {
          if (!submittedWeeks.includes(w)) {
            consecutiveMissed++;
          } else {
            break;
          }
        }

        if (consecutiveMissed >= 2) {
          await notifyMaddy(
            '2 Consecutive Missed Check-ins',
            `Client: ${client.name} (${client.phone})\nProgram: ${client.program}\nMissed weeks: ${consecutiveMissed}`
          );
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', {
          name: client.name || 'there',
          templateParams: [
            client.name || 'there',
            String(weekNo),
            checkinUrl
          ]
        });

        sent++;
      } catch (err) {
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    return res.status(200).json({ ok: true, sent, errors: errors.length, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
