const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: activeClients } = await db
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
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const endDate = client.program_ends_at ? new Date(client.program_ends_at) : null;
      if (endDate && now > endDate) {
        await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      const { data: lastCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (lastCheckins || []).map(c => c.week_no);

      const missedConsecutive = !submittedWeeks.includes(currentWeek - 1) && !submittedWeeks.includes(currentWeek - 2);
      if (missedConsecutive && currentWeek >= 3) {
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          clientName: client.name,
          message: `Client has missed weeks ${currentWeek - 2} and ${currentWeek - 1}`
        });
        escalated++;
      }

      if (submittedWeeks.includes(currentWeek)) continue;

      const hinglish = isHinglish(client.market || 'GLOBAL');
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      const msgBody = hinglish
        ? `Week ${currentWeek} check-in time! Apna progress share karo: ${checkinUrl}`
        : `Time for your Week ${currentWeek} check-in! Share your progress here: ${checkinUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        params: [client.name || 'there', String(currentWeek), checkinUrl],
        body: msgBody
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in cron completed',
      sent,
      escalated,
      totalClients: activeClients.length
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
