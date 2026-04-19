const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/helpers');
const { escalateToMaddy } = require('../../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        if (weekNo < 1) continue;

        const maxWeeks = client.program === '12wk' ? 12 : client.program?.startsWith('6wk') ? 6 : 4;
        if (weekNo > maxWeeks) {
          await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
          continue;
        }

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existingCheckin) {
          skipped++;
          continue;
        }

        const { data: missedWeeks } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const lastSubmitted = missedWeeks && missedWeeks.length > 0 ? missedWeeks[0].week_no : 0;
        const consecutiveMissed = weekNo - lastSubmitted - 1;

        if (consecutiveMissed >= 2) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            client.phone,
            `Client: ${client.name}, Program: ${client.program}, Last submitted: Week ${lastSubmitted}`
          );
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          params: [client.name || 'there', String(weekNo), checkinUrl],
        });

        sent++;

        if (sent % 10 === 0) {
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (e) {
        errors.push({ client_id: client.id, error: e.message });
        console.error(`[CRON CHECKIN ERROR] ${maskPhone(client.phone)}: ${e.message}`);
      }
    }

    console.log(`[CRON WEEKLY-CHECKIN] sent=${sent} skipped=${skipped} errors=${errors.length}`);
    return res.status(200).json({ sent, skipped, errors: errors.length });
  } catch (err) {
    console.error('[CRON WEEKLY-CHECKIN ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
