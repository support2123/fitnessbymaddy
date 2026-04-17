const { supabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const endsAt = new Date(client.program_ends_at);
      if (now > endsAt) {
        await supabase.from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          message: `${client.name} has missed ${consecutiveMissed} consecutive check-ins (last: week ${lastSubmittedWeek}, current: week ${weekNo}).`,
        });
        escalated++;
      }

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      const checkinUrl = `${baseUrl}/checkin?c=${client.id}&w=${weekNo}`;

      const hinglish = isHinglish(client.phone?.startsWith('91') ? 'IN' : 'GLOBAL');

      try {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ], client.name);
        sent++;
      } catch (sendErr) {
        console.error(`Checkin send failed for client ${client.id}:`, sendErr.message);
      }
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      active_clients: activeClients.length,
      sent,
      escalated,
    });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
