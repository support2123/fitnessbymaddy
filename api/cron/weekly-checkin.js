const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/rate-limit');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (error || !clients) {
    console.error('Failed to fetch active clients:', error?.message);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  const results = { sent: 0, skipped: 0, escalated: 0 };
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://www.fitnessbymaddy.com';

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) {
      results.skipped++;
      continue;
    }

    const { data: existingCheckin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1)
      .single();

    if (existingCheckin) {
      results.skipped++;
      continue;
    }

    const { data: missedCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
    const consecutiveMissed = [weekNo - 1, weekNo - 2].filter(w => w > 0 && !submittedWeeks.includes(w)).length;

    if (consecutiveMissed >= 2) {
      await escalateToMaddy('2 consecutive missed check-ins', {
        phone: client.phone,
        name: client.name,
        message: `Client has missed ${consecutiveMissed} consecutive check-ins (current week: ${weekNo})`
      });
      results.escalated++;
    }

    const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(weekNo), checkinUrl]
    });
    await logMessage(client.phone, 'out', `Check-in form W${weekNo}`, 'weekly_checkin');
    results.sent++;
  }

  console.log(`Weekly check-in cron: ${results.sent} sent, ${results.skipped} skipped, ${results.escalated} escalated`);
  return res.status(200).json({ success: true, ...results, total: clients.length });
};
