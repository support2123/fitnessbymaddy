const { supabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    const results = { sent: 0, skipped: 0, errors: 0, nudged: 0 };

    for (const client of (activeClients || [])) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) {
          results.skipped++;
          continue;
        }

        const endDate = new Date(client.program_ends_at);
        if (now > endDate) {
          await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          results.skipped++;
          continue;
        }

        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) {
          results.skipped++;
          continue;
        }

        const { data: missedCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false });

        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        let consecutiveMissed = 0;
        for (let w = currentWeek - 1; w >= 1; w--) {
          if (!submittedWeeks.includes(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          await notifyMaddy(
            '2 Consecutive Missed Check-ins',
            `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nMissed weeks: ${consecutiveMissed}`
          );
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

        const waResult = await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ], true);

        if (waResult.ok) results.sent++;
        else results.errors++;

      } catch (err) {
        console.error(`Checkin send error for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
