const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;
    const baseUrl = process.env.VERCEL_PROJECT_URL || 'fitnessbymaddy.com';

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= 1 && w >= currentWeek - 3; w--) {
        if (!submittedWeeks.includes(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${maskPhone(client.phone)} (${client.name})\nMissed: ${consecutiveMissed} weeks\nProgram: ${client.program}`
        );
        escalated++;
      }

      const checkinUrl = `https://${baseUrl}/checkin?c=${client.id}&w=${currentWeek}`;
      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: `Hey ${client.name || 'there'}! Time for your Week ${currentWeek} check-in. Fill it out here: ${checkinUrl}`,
        params: [client.name || 'there', String(currentWeek), checkinUrl],
        isClient: true
      });
      sent++;
    }

    return res.status(200).json({
      success: true,
      total_clients: activeClients.length,
      checkins_sent: sent,
      escalations: escalated
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
