const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program', 'is', null);

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysDiff / 7));

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) {
        results.push({ client_id: client.id, status: 'already_submitted' });
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const consecutiveMissed = countConsecutiveMissed(weekNo, submittedWeeks);

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `${client.name || client.phone} — Week ${weekNo}, program: ${client.program}`
        );
      }

      const market = detectMarket(client.phone);
      const isHinglish = market === 'IN';

      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const msg = isHinglish
        ? `Hey ${client.name || 'there'}! 📋 Week ${weekNo} check-in time! Form fill karo:\n${formUrl}\n\nWeight, waist, photos aur feedback — sab daal do. Ye aapka next week ka plan customize karne mein help karega 💪`
        : `Hey ${client.name || 'there'}! 📋 Time for your Week ${weekNo} check-in!\n${formUrl}\n\nShare your weight, waist, photos and feedback — this helps customize your next week's plan 💪`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        params: [client.name || 'there', String(weekNo), formUrl]
      });

      results.push({ client_id: client.id, week_no: weekNo, status: 'sent' });
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function countConsecutiveMissed(currentWeek, submittedWeeks) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= 1; w--) {
    if (!submittedWeeks.includes(w)) {
      missed++;
    } else {
      break;
    }
  }
  return missed;
}
