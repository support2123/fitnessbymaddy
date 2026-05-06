const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    const results = { sent: 0, skipped: 0, errors: 0 };

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / 86400000);
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) {
          results.skipped++;
          continue;
        }

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) {
          results.skipped++;
          continue;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const lastTwoWeeks = [weekNo - 1, weekNo - 2];
        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        const consecutiveMissed = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

        if (consecutiveMissed && weekNo > 2) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name || maskPhone(client.phone)}\nPhone: ${maskPhone(client.phone)}\nWeeks missed: ${lastTwoWeeks.join(', ')}`
          );
        }

        results.sent++;
      } catch (err) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    console.log(`Weekly checkin cron: ${JSON.stringify(results)}`);
    res.status(200).json({ status: 'completed', results });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};
