const { getSupabase } = require('../_lib/supabase');
const { sendMessage } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');
const { maskPhone } = require('../_lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const { data: activeClients } = await db.from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await db.from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        results.push({ client_id: client.id, status: 'already_submitted' });
        continue;
      }

      const { data: missedCheckins } = await db.from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwo = [weekNo - 1, weekNo - 2];
      const missedConsecutive = lastTwo.every(w => w > 0 && !submittedWeeks.includes(w));

      if (missedConsecutive) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client: ${maskPhone(client.phone)}\nName: ${client.name}\nProgram: ${client.program}\nWeek: ${weekNo}`
        );
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendMessage(client.phone, null, 'weekly_checkin', true);

      results.push({ client_id: client.id, week: weekNo, status: 'sent' });
    }

    console.log(`Weekly check-in cron: processed ${results.length} clients`);
    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
