const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var auth = req.headers.authorization;
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var supabase = getSupabase();

    var { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error || !clients) {
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    var sent = 0;
    var errors = 0;

    for (var i = 0; i < clients.length; i++) {
      var client = clients[i];

      var startDate = new Date(client.program_started_at);
      var now = new Date();
      var daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      var weekNo = Math.floor(daysSinceStart / 7) + 1;

      var existing = await supabase.from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing.data) continue;

      var checkinUrl = 'https://fitnessbymaddy.com/checkin?c=' + client.id + '&w=' + weekNo;

      try {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
        sent++;
      } catch (sendErr) {
        console.error('Checkin send failed for client:', client.id);
        errors++;
      }
    }

    return res.status(200).json({
      status: 'ok',
      clients_total: clients.length,
      checkins_sent: sent,
      errors: errors
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
