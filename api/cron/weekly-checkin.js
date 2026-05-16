const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { checkMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ success: true, message: 'No active clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil(
        (Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        results.push({ client_id: client.id, status: 'already_submitted' });
        continue;
      }

      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'Champion',
        String(weekNo),
        formUrl
      ]);

      await checkMissedCheckins(client.id, client.phone);

      results.push({ client_id: client.id, week_no: weekNo, status: 'sent' });
    }

    return res.status(200).json({ success: true, processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
