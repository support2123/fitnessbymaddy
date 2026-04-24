const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalate');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    req.headers['x-vercel-cron'] !== '1' &&
    !req.headers['x-forwarded-for']?.includes('127.0.0.1')
  ) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, sent: 0 }));
    }

    let sent = 0;
    const errors = [];

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor(
          (now - startDate) / (1000 * 60 * 60 * 24)
        );
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1)
          .single();

        if (existing) continue;

        const { data: lastTwo } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        if (lastTwo && lastTwo.length >= 2) {
          const lastWeek = lastTwo[0].week_no;
          const prevWeek = lastTwo[1].week_no;
          if (weekNo - lastWeek >= 2 && lastWeek - prevWeek >= 2) {
            await escalateToMaddy({
              reason: '2 consecutive missed check-ins',
              phone: client.phone,
              details: `Client: ${client.name || 'Unknown'}, Program: ${client.program}, Last check-in: Week ${lastWeek}`,
            });
          }
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          bodyValues: [
            client.name || 'there',
            String(weekNo),
            checkinUrl,
          ],
        });

        sent++;
      } catch (clientErr) {
        errors.push({
          client_id: client.id,
          error: clientErr.message,
        });
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        ok: true,
        total_clients: clients.length,
        sent,
        errors: errors.length,
      })
    );
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
