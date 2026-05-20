const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.json({ message: 'No active clients', ...results });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        if (weekNo < 1) continue;

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

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        const { data: lead } = await db
          .from('leads')
          .select('market')
          .eq('phone', client.phone)
          .single();

        const market = lead?.market || 'GLOBAL';
        const params = market === 'IN'
          ? [`Hi ${client.name || 'champ'}! Week ${weekNo} ka check-in time hai 💪`, checkinUrl]
          : [`Hi ${client.name || 'champ'}! Time for your Week ${weekNo} check-in 💪`, checkinUrl];

        await sendWhatsApp(client.phone, 'weekly_checkin', params);
        results.sent++;
      } catch (err) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    await scheduleNudges(db, activeClients);

    return res.json({ success: true, ...results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function scheduleNudges(db, clients) {
  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    const { data: prevWeek } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo - 1)
      .single();

    const { data: twoWeeksAgo } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo - 2)
      .single();

    if (!prevWeek && !twoWeeksAgo && weekNo > 2) {
      await db.from('escalations').insert({
        phone: client.phone,
        reason: '2_consecutive_missed_checkins',
        context: `Client ${client.name || client.id} missed weeks ${weekNo - 2} and ${weekNo - 1}`,
      });
    }
  }
}
