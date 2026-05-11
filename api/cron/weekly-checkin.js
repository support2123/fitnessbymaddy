const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, getLanguage } = require('../../lib/market');
const { escalateMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const missedCount = await countMissedCheckins(db, client.id, weekNo);
      if (missedCount >= 2) {
        await escalateMissedCheckins(client.name, client.phone, missedCount);
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      if (getLanguage(market) === 'hinglish') {
        await sendWhatsApp(client.phone, 'weekly_checkin', [
          client.name || 'there',
          `Week ${weekNo}`,
          `Apna check-in form yahan bharo: ${checkinUrl}`
        ]);
      } else {
        await sendWhatsApp(client.phone, 'weekly_checkin', [
          client.name || 'there',
          `Week ${weekNo}`,
          `Submit your check-in here: ${checkinUrl}`
        ]);
      }

      sent++;
    }

    return res.json({ action: 'checkins_sent', sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

async function countMissedCheckins(db, clientId, currentWeek) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 3); w--) {
    const { data } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', clientId)
      .eq('week_no', w)
      .limit(1);

    if (!data || data.length === 0) missed++;
    else break;
  }
  return missed;
}
