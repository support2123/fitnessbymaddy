const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', now.toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const maxWeeks = getMaxWeeks(client.program);
      if (weekNo > maxWeeks) continue;

      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      if (lastCheckin && lastCheckin.week_no >= weekNo) continue;

      const missedConsecutive = lastCheckin
        ? weekNo - lastCheckin.week_no - 1
        : weekNo - 1;

      if (missedConsecutive >= 2) {
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          message: `${client.name || 'Client'} missed ${missedConsecutive} check-ins (week ${weekNo})`,
        });
        escalated++;
      }

      const { data: lead } = client.lead_id
        ? await db.from('leads').select('market').eq('id', client.lead_id).single()
        : { data: null };

      const market = lead ? lead.market : 'GLOBAL';
      const hinglish = isHinglish(market);

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        bodyValues: [
          client.name || 'Champion',
          String(weekNo),
          hinglish
            ? `Week ${weekNo} ka check-in time! Apna progress share karo 💪`
            : `Time for your Week ${weekNo} check-in! Share your progress 💪`,
          checkinUrl,
        ],
      });

      sent++;
    }

    return res.status(200).json({ sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

function getMaxWeeks(program) {
  const map = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4,
  };
  return map[program] || 6;
}
