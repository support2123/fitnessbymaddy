const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { json } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return json(res, { ok: true, sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp(client.phone, 'weekly_checkin', [
          client.name || 'there',
          weekNo.toString(),
          checkinUrl,
        ]);

        sent++;
      } catch (e) {
        console.error(`Check-in send failed for client ${client.id}:`, e.message);
        errors++;
      }
    }

    return json(res, { ok: true, sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
