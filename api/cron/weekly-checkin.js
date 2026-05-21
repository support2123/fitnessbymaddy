const { getSupabase } = require('../lib/supabase');
const { sendText, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;

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

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      if (market === 'IN') {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Week ${weekNo} check-in time.\n\n` +
          `Yeh form fill kar do — weight, waist, photos, aur kaise feel kar rahe ho:\n` +
          `${checkinUrl}\n\n` +
          `Consistency hi key hai. Keep going!`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in.\n\n` +
          `Please fill out this quick form — weight, waist, photos, and how you're feeling:\n` +
          `${checkinUrl}\n\n` +
          `Consistency is key. Keep pushing!`
        );
      }

      sent++;
    }

    return res.json({ ok: true, sent, total_clients: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
