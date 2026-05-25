const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret (Vercel sends this header)
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of clients) {
    // Calculate current week
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    // Check if already submitted this week
    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) continue;

    // Check for 2 consecutive missed check-ins
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1);

    const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
    if (weekNo - lastCheckinWeek >= 3) {
      await notifyMaddy('2+ consecutive missed check-ins', {
        name: client.name,
        phone: client.phone,
        message: `Last check-in was week ${lastCheckinWeek}, now week ${weekNo}`
      });
      escalated++;
    }

    // Send check-in form link
    const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
    await sendWhatsApp(client.phone, 'weekly_checkin', {
      name: client.name,
      templateParams: [client.name, String(weekNo), checkinUrl]
    }).catch(() => {});

    await supabase.from('messages').insert({
      phone: client.phone,
      direction: 'out',
      body: `Week ${weekNo} check-in form sent`,
      template_name: 'weekly_checkin',
      sent_at: new Date().toISOString(),
      status: 'sent'
    });

    sent++;
  }

  return res.status(200).json({ success: true, sent, escalated, total_clients: clients.length });
};
