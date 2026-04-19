const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');
const { PROGRAM_DURATIONS_WEEKS, cors } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers.authorization;
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = [];

    for (const client of clients) {
      const weekNo = calculateCurrentWeek(client);
      const maxWeeks = PROGRAM_DURATIONS_WEEKS[client.program] || 12;

      if (weekNo > maxWeeks) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existingCheckin) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        bodyValues: [
          client.name || 'there',
          `Week ${weekNo}`,
          `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`
        ]
      });

      await checkMissedCheckins(client.id);

      results.push({ client_id: client.id, action: 'checkin_sent', week: weekNo });
    }

    return res.status(200).json({ processed: results.length, results });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(client) {
  const started = new Date(client.program_started_at);
  const now = new Date();
  const diffMs = now - started;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return diffWeeks + 1;
}
