const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, escalated: 0, errors: 0 };

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ...results, message: 'no active clients' });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) {
          results.skipped++;
          continue;
        }

        const endDate = new Date(client.program_ends_at);
        if (now > endDate) {
          await db.from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          results.skipped++;
          continue;
        }

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) {
          results.skipped++;
          continue;
        }

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        let consecutiveMissed = 0;
        for (let w = weekNo - 1; w >= Math.max(1, weekNo - 2); w--) {
          if (!submittedWeeks.includes(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          await escalateToMaddy({
            reason: '2 consecutive missed check-ins',
            phone: client.phone,
            details: `${client.name || 'Client'} - ${client.program} - Week ${weekNo}`,
          });
          results.escalated++;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          bodyValues: [
            client.name || 'there',
            weekNo.toString(),
            checkinUrl,
          ],
        });

        results.sent++;

      } catch (clientErr) {
        console.error(`Checkin send error for client ${client.id}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.json(results);

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
