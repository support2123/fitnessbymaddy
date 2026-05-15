const { getSupabase } = require('../../lib/supabase');
const { sendWhatsAppDirect } = require('../../lib/whatsapp');
const { detectMarket, isHinglishMarket, maskPhone } = require('../../lib/utils');
const { escalateToMaddy } = require('../../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients, error } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    const results = [];

    for (const client of activeClients || []) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        results.push({ client_id: client.id, action: 'already_submitted', week: weekNo });
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
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          details: `Client: ${client.name || maskPhone(client.phone)}, Week ${weekNo}, Missed: ${consecutiveMissed}`
        });
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglishMarket(market);
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in ka time aa gaya. Apna progress share karein: ${checkinUrl}`
        : `Hey ${client.name || 'there'}! It's time for your Week ${weekNo} check-in. Share your progress: ${checkinUrl}`;

      await sendWhatsAppDirect({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        params: [client.name || 'there', String(weekNo), checkinUrl]
      });

      results.push({ client_id: client.id, action: 'checkin_sent', week: weekNo });
    }

    return res.status(200).json({
      processed: results.length,
      results
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7) + 1;
}

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
