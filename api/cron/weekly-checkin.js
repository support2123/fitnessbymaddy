const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var db = getClient();
    var now = new Date();

    var clientsResult = await db.from('clients').select('*').eq('status', 'active');
    var clients = clientsResult.data;

    if (!clients || !clients.length) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    var sent = 0;
    for (var i = 0; i < clients.length; i++) {
      var client = clients[i];

      var startDate = new Date(client.program_started_at);
      var weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
      if (weekNo < 1) continue;

      // Skip if already submitted
      var existingResult = await db.from('checkins').select('id')
        .eq('client_id', client.id).eq('week_no', weekNo).single();
      if (existingResult.data) continue;

      var checkinUrl = 'https://fitnessbymaddy.com/checkin?c=' + client.id + '&w=' + weekNo;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ], true);

      sent++;
    }

    return res.status(200).json({ ok: true, sent: sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
