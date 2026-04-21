const { getClient } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getClient();

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
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { data: lead } = await supabase
        .from('leads')
        .select('market')
        .eq('id', client.lead_id)
        .single();

      const market = lead?.market || 'GLOBAL';
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const msg = isHinglish(market)
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time 💪\n\nApna progress yahan submit karo:\n${checkinUrl}\n\nWeight, waist, photos, aur kaise feel kar rahe ho — sab daal do!`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in 💪\n\nSubmit your progress here:\n${checkinUrl}\n\nInclude your weight, waist, photos, and how you're feeling!`;

      await sendText(client.phone, msg, { supabase });
      sent++;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const recentWeeks = (missedCheckins || []).map((c) => c.week_no);
      if (weekNo >= 3 && !recentWeeks.includes(weekNo - 1) && !recentWeeks.includes(weekNo - 2)) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          { phone: client.phone, detail: `${client.name} — weeks ${weekNo - 2} & ${weekNo - 1} missed` },
          { whatsapp: { sendText }, supabase }
        );
        escalated++;
      }
    }

    return res.status(200).json({ ok: true, sent, escalated });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
