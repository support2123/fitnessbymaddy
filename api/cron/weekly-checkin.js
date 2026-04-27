const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
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
      const weekNo = Math.floor(daysSinceStart / 7) + 1;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        results.push({ client_id: client.id, status: 'already_submitted' });
        continue;
      }

      const { data: lastTwo } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwo && lastTwo.length >= 2) {
        const expectedWeeks = [weekNo - 1, weekNo - 2];
        const submittedWeeks = lastTwo.map(c => c.week_no);
        const missed = expectedWeeks.filter(w => !submittedWeeks.includes(w));
        if (missed.length >= 2) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            client_id: client.id,
            phone: maskPhone(client.phone),
            missed_weeks: missed
          });
        }
      }

      const checkinLink = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const msg = `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in.\n\nFill it out here:\n${checkinLink}\n\nWeight, waist, photos, and how you're feeling - it all helps us dial in your next week!`;

      await sendWhatsApp(client.phone, msg, null);
      results.push({ client_id: client.id, week_no: weekNo, status: 'sent' });
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
