const { supabase } = require('../_lib/supabase');
const { sendTemplate, sendTextMessage } = require('../_lib/whatsapp');
const { isHinglishMarket, detectMarket } = require('../_lib/market');
const { createEscalation } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

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

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 3); w--) {
        if (!submittedWeeks.includes(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await createEscalation(
          client.phone,
          '2 consecutive missed check-ins',
          `Client: ${client.name}, Last submitted: week ${submittedWeeks[0] || 'none'}`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'Champion',
        String(currentWeek),
        checkinUrl,
      ]);

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
