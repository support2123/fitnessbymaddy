const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const results = { sent: 0, skipped: 0, escalated: 0, errors: 0 };

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of clients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);

        if (weekNo < 1) {
          results.skipped++;
          continue;
        }

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) {
          results.skipped++;
          continue;
        }

        const { data: missedCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const lastSubmitted = missedCheckins && missedCheckins.length > 0
          ? missedCheckins[0].week_no
          : 0;

        if (weekNo - lastSubmitted >= 3) {
          await escalateToMaddy(
            '2+ consecutive missed check-ins',
            `Client: ${client.name} (${client.id})\nLast check-in: Week ${lastSubmitted}\nCurrent week: ${weekNo}`,
            { supabase }
          );
          results.escalated++;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);

        if (isHinglish(market)) {
          await sendTemplate(client.phone, 'weekly_checkin', [
            client.name,
            String(weekNo),
            checkinUrl,
          ], { supabase });
        } else {
          await sendTemplate(client.phone, 'weekly_checkin_en', [
            client.name,
            String(weekNo),
            checkinUrl,
          ], { supabase });
        }

        results.sent++;
      } catch (clientErr) {
        console.error(`Checkin send failed for ${client.id}:`, clientErr.message);
        results.errors++;
      }
    }

    await scheduleNudges(supabase, clients);

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}

async function scheduleNudges(supabase, clients) {
  for (const client of clients) {
    const weekNo = calculateWeekNo(client.program_started_at);
    const nudge24h = new Date();
    nudge24h.setHours(nudge24h.getHours() + 24);
    const nudge48h = new Date();
    nudge48h.setHours(nudge48h.getHours() + 48);

    await supabase.from('scheduled_nudges').upsert({
      client_id: client.id,
      week_no: weekNo,
      nudge_24h_at: nudge24h.toISOString(),
      nudge_48h_at: nudge48h.toISOString(),
      nudge_24h_sent: false,
      nudge_48h_sent: false,
    }, { onConflict: 'client_id,week_no' });
  }
}
