const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { json } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return json(res, 200, { message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          `Week ${weekNo}`,
          checkinUrl
        ]);

        sent++;
      } catch (err) {
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    return json(res, 200, { message: `Check-in reminders sent`, sent, errors: errors.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return json(res, 500, { error: 'Internal server error' });
  }
};
