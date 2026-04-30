const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');
const { maskPhone } = require('../_lib/masking');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients', results });
    }

    for (const client of activeClients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) {
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
            phone: maskPhone(client.phone),
            message: `${client.name || 'Client'} missed ${consecutiveMissed} consecutive check-ins`,
          });
          results.escalated++;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          bodyValues: [client.name || 'there', String(weekNo), checkinUrl],
        });

        results.sent++;
      } catch (clientErr) {
        console.error(`Check-in error for ${maskPhone(client.phone)}:`, clientErr);
        results.errors++;
      }
    }

    await sendNudges(db, results);

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('weekly-checkin cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function sendNudges(db, results) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: clientsNeedingNudge } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clientsNeedingNudge) return;

  for (const client of clientsNeedingNudge) {
    const weekNo = calculateWeekNo(client.program_started_at);
    if (weekNo < 1) continue;

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (checkin && checkin.length > 0) continue;

    const { data: recentNudge } = await db
      .from('messages')
      .select('id')
      .eq('phone', client.phone)
      .eq('template_name', 'checkin_nudge')
      .gte('sent_at', twoDaysAgo)
      .limit(1);

    if (recentNudge && recentNudge.length > 0) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'checkin_nudge',
      bodyValues: [client.name || 'there', checkinUrl],
    });
    results.nudged++;
  }
}

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

function countConsecutiveMissed(currentWeek, submittedWeeks) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= 1; w--) {
    if (submittedWeeks.includes(w)) break;
    missed++;
  }
  return missed;
}
