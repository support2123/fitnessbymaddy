const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/phone');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lt('program_ends_at', new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', count: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          params: [client.name || 'there', `${currentWeek}`, checkinUrl]
        });

        sent++;

        scheduleNudges(db, client, currentWeek, checkinUrl);

      } catch (clientErr) {
        console.error(`Checkin send error for ${maskPhone(client.phone)}:`, clientErr.message);
        errors++;
      }
    }

    console.log(`Weekly checkin cron: sent=${sent}, errors=${errors}`);
    return res.status(200).json({ ok: true, sent, errors });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function scheduleNudges(db, client, weekNo, checkinUrl) {
  const oneDay = 24 * 60 * 60 * 1000;

  setTimeout(async () => {
    try {
      const { data } = await db.from('checkins')
        .select('id').eq('client_id', client.id).eq('week_no', weekNo).single();
      if (!data) {
        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_nudge',
          params: [client.name || 'there', checkinUrl]
        });
      }
    } catch (e) { console.error('Nudge +24h:', e.message); }
  }, oneDay);

  setTimeout(async () => {
    try {
      const { data } = await db.from('checkins')
        .select('id').eq('client_id', client.id).eq('week_no', weekNo).single();
      if (!data) {
        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_nudge_final',
          params: [client.name || 'there', checkinUrl]
        });
      }
    } catch (e) { console.error('Nudge +48h:', e.message); }
  }, 2 * oneDay);
}
