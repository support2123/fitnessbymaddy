const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, maskPhone } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, escalated: 0, errors: 0 };

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of clients) {
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
          await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
          results.skipped++;
          continue;
        }

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) {
          results.skipped++;
          continue;
        }

        const { count: missedCount } = await db
          .from('checkins')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('week_no', currentWeek - 2);

        const expectedCheckins = Math.min(currentWeek, 2);
        if (missedCount !== null && missedCount < expectedCheckins - 1) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: maskPhone(client.phone),
            name: client.name,
            message: `Client has missed check-ins. Current week: ${currentWeek}`,
          });
          results.escalated++;
        }

        const token = Buffer.from(`${client.id}-${currentWeek}`).toString('base64');
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}&t=${token}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl,
        ]);

        await db.from('messages').insert({
          phone: client.phone,
          direction: 'out',
          body: `Weekly check-in form for week ${currentWeek}`,
          template_name: 'weekly_checkin',
          sent_at: new Date().toISOString(),
          status: 'sent',
        });

        results.sent++;
      } catch (clientErr) {
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
