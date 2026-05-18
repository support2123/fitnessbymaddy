const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { notifyMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
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
      const weekNo = calculateWeekNo(client.program_started_at);
      const durationWeeks = getDurationWeeks(client.program);

      if (weekNo > durationWeeks) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const hinglish = isHinglish(client.market);

      if (hinglish) {
        await sendTemplate(client.phone, 'weekly_checkin_hi', [
          client.name,
          String(weekNo),
          checkinUrl
        ]);
      } else {
        await sendTemplate(client.phone, 'weekly_checkin_en', [
          client.name,
          String(weekNo),
          checkinUrl
        ]);
      }
      sent++;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoExpected = [weekNo - 1, weekNo - 2].filter(w => w > 0);
      const consecutiveMissed = lastTwoExpected.every(w => !submittedWeeks.includes(w));

      if (consecutiveMissed && weekNo > 2) {
        await notifyMaddy(
          client.phone,
          `2 consecutive missed check-ins (weeks ${weekNo - 2} & ${weekNo - 1})`,
          `Client: ${client.name}, Program: ${client.program}`
        );
        escalated++;
      }
    }

    return res.status(200).json({
      message: 'Weekly check-in sent',
      sent,
      escalated,
      total_active: activeClients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(diffDays / 7));
}

function getDurationWeeks(program) {
  const map = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return map[program] || 12;
}
