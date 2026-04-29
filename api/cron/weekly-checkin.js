const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { PROGRAM_DETAILS, maskPhone } = require('../../lib/utils');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);
      const details = PROGRAM_DETAILS[client.program];

      if (details && weekNo > details.weeks) continue;
      if (weekNo < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existingCheckin) continue;

      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        formUrl,
      ]);

      await checkMissedCheckins(client.id);
      sent++;

      console.log(`[CRON] Checkin sent to ${maskPhone(client.phone)} week ${weekNo}`);
    }

    return res.status(200).json({ ok: true, sent, total: activeClients.length });
  } catch (err) {
    console.error('[WEEKLY CHECKIN CRON ERROR]', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
