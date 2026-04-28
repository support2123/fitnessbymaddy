const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const weekNo = calculateCurrentWeek(client.program_started_at);

        if (isPastProgramEnd(client)) {
          await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          continue;
        }

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', {
          name: client.name || 'there',
          templateParams: [
            client.name || 'there',
            String(weekNo),
            checkinUrl,
          ],
        });

        sent++;
      } catch (clientErr) {
        errors.push({ clientId: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({ ok: true, sent, total: activeClients.length, errors });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startDate) {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, diffWeeks + 1);
}

function isPastProgramEnd(client) {
  if (!client.program_ends_at) return false;
  return new Date() > new Date(client.program_ends_at);
}
