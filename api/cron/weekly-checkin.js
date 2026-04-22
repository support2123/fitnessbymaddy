const { supabase } = require('../_lib/supabase');
const { sendTemplate, sendText } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal && req.method === 'GET') {
    // Vercel cron doesn't always send auth, allow GET from Vercel
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      // Check if already submitted this week
      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      if (currentWeek - lastCheckinWeek >= 3) {
        await escalateToMaddy(
          '2+ consecutive missed check-ins',
          client.phone,
          `${client.name} — last check-in was week ${lastCheckinWeek}, now on week ${currentWeek}`
        );
        escalated++;
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      const msg = hinglish
        ? `Hey ${client.name}! 📋 Week ${currentWeek} ka check-in time hai. Form fill kar do:\n${checkinUrl}\n\nPhotos + weight + waist measure zaroor dena 💪`
        : `Hey ${client.name}! 📋 Time for your Week ${currentWeek} check-in. Please fill out this form:\n${checkinUrl}\n\nDon't forget photos + weight + waist measurements 💪`;

      await sendTemplate(client.phone, 'weekly_checkin', [client.name || 'there', String(currentWeek), checkinUrl]);
      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total_clients: activeClients.length });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
