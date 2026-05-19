const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    for (const client of activeClients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const { data: missedWeeks } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const lastSubmitted = missedWeeks?.[0]?.week_no || 0;
        const consecutiveMissed = weekNo - lastSubmitted - 1;

        if (consecutiveMissed >= 2) {
          await escalateToMaddy({
            reason: '2 consecutive missed check-ins',
            phone: client.phone,
            message: `${client.name} has missed ${consecutiveMissed} check-ins (current week: ${weekNo})`,
            clientName: client.name,
          });
          results.escalated++;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          bodyValues: [client.name || 'Champion', `${weekNo}`, checkinUrl],
        });

        results.sent++;
      } catch (err) {
        console.error(`Error for client ${client.id}:`, err.message);
        results.errors++;
      }
    }

    await sendNudges(db, results);

    return res.status(200).json({ status: 'ok', results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function sendNudges(db, results) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: recentMessages } = await db
    .from('messages')
    .select('phone, template_name, sent_at')
    .eq('direction', 'out')
    .in('template_name', ['weekly_checkin', 'checkin_nudge_1', 'checkin_nudge_2'])
    .gte('sent_at', twoDaysAgo);

  if (!recentMessages) return;

  const nudgeMap = {};
  for (const msg of recentMessages) {
    if (!nudgeMap[msg.phone]) nudgeMap[msg.phone] = [];
    nudgeMap[msg.phone].push(msg);
  }

  for (const [phone, msgs] of Object.entries(nudgeMap)) {
    const hasCheckin = msgs.some(m => m.template_name === 'weekly_checkin');
    const hasNudge1 = msgs.some(m => m.template_name === 'checkin_nudge_1');
    const hasNudge2 = msgs.some(m => m.template_name === 'checkin_nudge_2');

    const checkinMsg = msgs.find(m => m.template_name === 'weekly_checkin');
    if (!checkinMsg) continue;

    const checkinAge = Date.now() - new Date(checkinMsg.sent_at).getTime();

    if (checkinAge > 24 * 60 * 60 * 1000 && !hasNudge1) {
      await sendWhatsApp({
        phone,
        templateName: 'checkin_nudge_1',
        bodyValues: ['there'],
      });
      results.nudged++;
    } else if (checkinAge > 48 * 60 * 60 * 1000 && hasNudge1 && !hasNudge2) {
      await sendWhatsApp({
        phone,
        templateName: 'checkin_nudge_2',
        bodyValues: ['there'],
      });
      results.nudged++;
    }
  }
}

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil((diffDays + 1) / 7);
}
