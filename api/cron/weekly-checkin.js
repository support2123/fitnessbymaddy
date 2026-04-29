const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { checkMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  // Verify cron authorization
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  // Get all active clients
  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (error || !clients) {
    console.error('Failed to fetch clients:', error?.message);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  let sent = 0;
  let nudged = 0;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const weekNo = Math.ceil(
      (Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

    // Skip if program ended
    if (client.program_ends_at && new Date(client.program_ends_at) < new Date()) {
      continue;
    }

    // Check if already submitted this week
    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) continue;

    // Check for 2 consecutive missed check-ins
    await checkMissedCheckins(client.id, client.phone);

    // Send check-in form link
    const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    const name = client.name ? client.name.split(' ')[0] : 'there';

    await sendWhatsApp({
      phone: client.phone,
      body: `Hey ${name}! 📝 It's check-in time (Week ${weekNo}).\n\nPlease fill this quick form — weight, measurements, how you're feeling, and progress pics:\n\n${checkinUrl}\n\nThis helps us keep your program perfectly dialled in. 💪`
    });

    sent++;
  }

  return res.status(200).json({
    success: true,
    clients_total: clients.length,
    checkins_sent: sent,
    nudges_sent: nudged
  });
};
