const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');
const { weeksBetween } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, program_ends_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const now = new Date();
    const results = [];

    for (const client of clients) {
      if (new Date(client.program_ends_at) < now) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      const weekNo = weeksBetween(client.program_started_at, now.toISOString());

      await checkMissedCheckins(client.id, client.phone);

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        weekNo.toString(),
        checkinUrl,
      ]);

      results.push({ client_id: client.id, action: 'checkin_sent', week: weekNo });
    }

    return res.status(200).json({ success: true, processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
