const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

/**
 * Masks a phone number for safe logging.
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, -4).replace(/.(?=.{4})/g, '*').slice(0, -4) + phone.slice(-4);
}

/**
 * Calculate current week number based on program start date.
 */
function getCurrentWeek(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return diffWeeks + 1; // Week 1 is the first week
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    /* ── Verify cron secret ── */
    const authHeader = req.headers['authorization'] || '';
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || !authHeader.includes(cronSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = getSupabase();
    const now = new Date().toISOString();

    /* ── Query all active clients ── */
    const { data: clients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at, program_ends_at, program_type')
      .eq('status', 'active');

    if (clientsErr) {
      console.error('weekly-checkin: failed to query clients:', clientsErr.message);
      return res.status(500).json({ error: 'Failed to query clients' });
    }

    let processed = 0;
    const escalations = [];

    for (const client of clients || []) {
      /* ── Skip if program has ended ── */
      if (client.program_ends_at && new Date(client.program_ends_at) < new Date()) {
        continue;
      }

      const weekNo = getCurrentWeek(client.program_started_at);

      /* ── Send check-in form link via WhatsApp ── */
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      try {
        await sendWhatsApp(client.phone, 'weekly_checkin_v1', {
          name: client.name || '',
          week_no: weekNo,
          checkin_url: checkinUrl,
        });
        processed++;
      } catch (sendErr) {
        console.error(
          `weekly-checkin: send failed [${maskPhone(client.phone)}]:`,
          sendErr.message
        );
      }

      /* ── Check for 2+ consecutive missed check-ins ── */
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const submittedWeeks = (recentCheckins || []).map((c) => c.week_no);
      // Check if the last two expected weeks are both missing
      const lastTwoExpected = [weekNo - 1, weekNo - 2];
      const missedConsecutive = lastTwoExpected.every(
        (w) => w > 0 && !submittedWeeks.includes(w)
      );

      if (missedConsecutive && weekNo > 2) {
        escalations.push({
          client_id: client.id,
          phone: client.phone,
          name: client.name,
          missed_weeks: lastTwoExpected,
        });
      }
    }

    /* ── Escalate missed check-ins to Maddy ── */
    if (escalations.length > 0) {
      const maddyPhone = process.env.MADDY_PHONE || '';
      if (maddyPhone) {
        const summary = escalations
          .map(
            (e) =>
              `${e.name || maskPhone(e.phone)}: missed weeks ${e.missed_weeks.join(', ')}`
          )
          .join('\n');

        await sendWhatsApp(maddyPhone, 'escalation_missed_checkins_v1', {
          count: escalations.length,
          summary,
        });
      }
    }

    return res.status(200).json({ processed, escalations: escalations.length });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
