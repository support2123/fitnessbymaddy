const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');
const { maskPhone } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
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
      for (let w = weekNo - 1; w >= 1 && w >= weekNo - 3; w--) {
        if (!submittedWeeks.includes(w)) {
          consecutiveMissed++;
        } else {
          break;
        }
      }

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 Consecutive Missed Check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nMissed weeks: ${consecutiveMissed}`
        );
        escalated++;
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const body = hinglish
        ? `Hey ${client.name}! Week ${weekNo} check-in time. Apna progress share karo:\n\n${checkinUrl}\n\nWeight, waist, photos aur compliance rate fill karo. Ye data aapke next week ka plan decide karta hai.`
        : `Hey ${client.name}! Time for your Week ${weekNo} check-in. Share your progress:\n\n${checkinUrl}\n\nFill in your weight, waist, photos and compliance rate. This data shapes your next week's plan.`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body,
        params: [client.name, String(weekNo), checkinUrl]
      });

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
