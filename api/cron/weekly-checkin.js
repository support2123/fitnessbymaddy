const { supabase } = require('../../lib/supabase');
const { sendWhatsAppForced } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const consecutiveMissed = countConsecutiveMissed(weekNo, submittedWeeks);

      if (consecutiveMissed >= 2) {
        await escalateToMaddy({
          reason: '2_consecutive_missed_checkins',
          phone: client.phone,
          clientName: client.name,
          message: `${client.name} has missed ${consecutiveMissed} consecutive check-ins (current week: ${weekNo})`
        });
        escalated++;
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! 📊 Week ${weekNo} check-in time! Yeh form fill karo toh hum aapka next week ka plan bana sakein:\n${checkinUrl}`
        : `Hey ${client.name || 'there'}! 📊 Time for your Week ${weekNo} check-in! Fill out this form so we can build your next week's plan:\n${checkinUrl}`;

      await sendWhatsAppForced({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        params: [client.name || 'there', String(weekNo), checkinUrl]
      });

      sent++;
    }

    return res.json({ ok: true, processed: clients.length, sent, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function countConsecutiveMissed(currentWeek, submittedWeeks) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= 1; w--) {
    if (submittedWeeks.includes(w)) break;
    missed++;
  }
  return missed;
}
