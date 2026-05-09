const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

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
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastTwoWeeks = [currentWeek - 1, currentWeek - 2];
      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const consecutiveMissed = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

      if (consecutiveMissed && currentWeek > 2) {
        await sendWhatsApp('+917082478374', 'escalation_alert', [
          maskPhone(client.phone),
          '2_consecutive_missed_checkins',
          `Client ${client.name || 'Unknown'} missed weeks ${currentWeek - 2} and ${currentWeek - 1}`,
        ]);
        escalated++;
      }

      const market = detectMarket(client.phone);
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      const templateName = market === 'IN' ? 'weekly_checkin_hi' : 'weekly_checkin_en';
      await sendWhatsApp(client.phone, templateName, [
        client.name || 'there',
        String(currentWeek),
        checkinUrl,
      ]);

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      total_clients: activeClients.length,
      sent,
      escalated,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
