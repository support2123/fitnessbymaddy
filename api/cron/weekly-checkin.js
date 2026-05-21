const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients?.length) {
      return res.status(200).json({ message: 'No active clients', count: 0 });
    }

    let sent = 0;
    let skipped = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) { skipped++; continue; }

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existingCheckin?.length > 0) { skipped++; continue; }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoWeeks = [currentWeek - 1, currentWeek - 2];
      const consecutiveMisses = lastTwoWeeks.filter(w => w > 0 && !submittedWeeks.includes(w)).length;

      if (consecutiveMisses >= 2) {
        await escalateToMaddy({
          phone: client.phone,
          reason: '2 consecutive missed check-ins',
          messageBody: `${client.name || 'Client'} has missed ${consecutiveMisses} consecutive check-ins.`,
          clientId: client.id,
        });
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        bodyValues: hinglish
          ? [client.name || 'there', `Week ${currentWeek} check-in time! Apna progress share karo:`, checkinUrl]
          : [client.name || 'there', `Time for your Week ${currentWeek} check-in! Share your progress:`, checkinUrl],
      });

      sent++;
    }

    return res.status(200).json({
      success: true,
      sent,
      skipped,
      escalated,
      total: activeClients.length,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
