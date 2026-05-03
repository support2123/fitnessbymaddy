const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.status(200).json({ action: 'no_active_clients' });
  }

  const results = [];

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.floor(daysSinceStart / 7) + 1;

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) {
      results.push({ client_id: client.id, action: 'already_submitted' });
      continue;
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', {
      name: client.name,
      templateParams: [client.name, `Week ${weekNo}`, checkinUrl]
    });

    results.push({ client_id: client.id, action: 'sent', week: weekNo });
  }

  return res.status(200).json({ processed: results.length, results });
};
