const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { MADDY_PHONE, maskPhone } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const endDate = new Date(client.program_ends_at);
      if (now > endDate) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) {
        results.push({ client_id: client.id, action: 'already_checked_in', week: weekNo });
        continue;
      }

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await sendWhatsApp({
          phone: MADDY_PHONE,
          templateName: 'escalation_alert',
          params: [maskPhone(client.phone), '2 consecutive missed check-ins', `Week ${weekNo}`],
          body: `ESCALATION — 2 missed check-ins\nClient: ${maskPhone(client.phone)}\nLast submitted: Week ${lastSubmittedWeek}\nCurrent: Week ${weekNo}`
        });
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const hinglish = isHinglish(client.market || 'IN');

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weekNo} ka check-in time hai. Apna progress yahan fill karo: ${checkinUrl}`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Fill it out here: ${checkinUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        params: [client.name || 'there', String(weekNo), checkinUrl],
        body: msg
      });

      results.push({ client_id: client.id, action: 'checkin_sent', week: weekNo });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
