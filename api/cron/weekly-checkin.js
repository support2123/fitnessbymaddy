const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, maskPhone } = require('../_lib/whatsapp');
const { cors } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ message: 'No active clients' });
  }

  const results = [];

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    if (weekNo < 1) continue;

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

    const sent = await sendWhatsApp(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(weekNo),
      checkinUrl
    ]);

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const missedCount = weekNo - (missedCheckins?.length || 0);
    if (missedCount >= 2) {
      await sendWhatsApp(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        [maskPhone(client.phone), `${client.name} has ${missedCount} missed check-ins`]
      );
    }

    results.push({
      client_id: client.id,
      week_no: weekNo,
      sent: !sent.rateLimited && !sent.optedOut
    });
  }

  return res.status(200).json({ processed: results.length, results });
};
