const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { verifyCron, getProgramWeeks } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;
      const totalWeeks = getProgramWeeks(client.program);

      if (currentWeek > totalWeeks) {
        await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
        await sendWhatsApp(client.phone, 'program_complete', [
          client.name || 'there',
        ]);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) {
        results.push({ client_id: client.id, action: 'already_submitted', week: currentWeek });
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl,
      ]);

      results.push({ client_id: client.id, action: 'checkin_sent', week: currentWeek });
    }

    return res.status(200).json({ success: true, processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
