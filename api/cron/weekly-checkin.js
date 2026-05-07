const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');
const { createEscalation, notifyMaddy } = require('../_lib/escalation');

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
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Failed to fetch active clients:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients || []) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) { skipped++; continue; }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) { skipped++; continue; }

      const { data: missedWeeks } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmitted = missedWeeks?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastSubmitted - 1;

      if (consecutiveMissed >= 2) {
        await createEscalation(
          client.phone,
          '2_consecutive_missed_checkins',
          `Client missed ${consecutiveMissed} consecutive check-ins (current: week ${weekNo})`,
          client.id
        );
        await notifyMaddy('Missed check-ins', client.phone,
          `${client.name || 'Client'} missed ${consecutiveMissed} consecutive check-ins`);
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      const msg = isHinglish(market)
        ? `Hey ${client.name || ''}! 📋 Week ${weekNo} check-in ka time hai.\n\nYahan submit karo: ${checkinUrl}\n\nWeight, waist, photos aur apna progress share karo. Yeh zaroori hai best results ke liye! 💪`
        : `Hey ${client.name || ''}! 📋 Time for your Week ${weekNo} check-in.\n\nSubmit here: ${checkinUrl}\n\nShare your weight, waist, photos and progress. This is essential for best results! 💪`;

      await sendWhatsApp(client.phone, msg, null, true);
      sent++;
    }

    return res.status(200).json({ sent, skipped, total: clients?.length || 0 });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.ceil(diffDays / 7);
}
