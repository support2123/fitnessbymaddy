const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sb = getSupabase();

    const { data: activeClients } = await sb
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let nudges = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await sb
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { count: consecutiveMissed } = await sb
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2)
        .lte('week_no', weekNo - 1);

      const expectedCheckins = Math.min(weekNo - 1, 2);
      const actualMissed = expectedCheckins - (consecutiveMissed || 0);

      if (actualMissed >= 2) {
        await notifyMaddy(
          `⚠️ 2 CONSECUTIVE MISSED CHECK-INS\nClient: ${client.name || client.phone}\nProgram: ${client.program}\nWeek: ${weekNo}`
        );
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! 📋 Week ${weekNo} ka check-in time!\n\nApna progress yahan submit karo:\n${checkinUrl}\n\nWeight, waist, photos aur apna feedback share karo — hum iske basis pe aapka next week ka plan banayenge 💪`
        : `Hey ${client.name || 'there'}! 📋 Time for your Week ${weekNo} check-in!\n\nSubmit your progress here:\n${checkinUrl}\n\nShare your weight, waist, photos and feedback — we'll use this to build your next week's plan 💪`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);

      sent++;
    }

    return res.status(200).json({ ok: true, sent, total_clients: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
