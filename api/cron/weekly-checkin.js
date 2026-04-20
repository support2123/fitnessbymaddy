const { getClient } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  // Verify cron authorization
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();

    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients?.length) {
      return res.json({ ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      // Check if already submitted this week
      const { data: existing } = await db
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      // Check for previous unsent nudges
      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      // Check for 2 consecutive missed check-ins
      const missedWeeks = weekNo - (lastCheckin?.week_no || 0) - 1;
      if (missedWeeks >= 2) {
        const { escalateToMaddy } = require('../../lib/escalation');
        await escalateToMaddy(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name} missed ${missedWeeks} check-ins. Last: week ${lastCheckin?.week_no || 0}`
        );
      }

      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        isClient: true,
        templateParams: [client.name || 'there', String(weekNo), formUrl],
      });
      sent++;
    }

    // Nudge overdue check-ins (24hr and 48hr)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const { data: allActive } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    for (const client of (allActive || [])) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      // Check how many nudges already sent this week
      const { data: nudges } = await db
        .from('messages')
        .select('id')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .like('body', '%checkin%')
        .gte('sent_at', getWeekStart().toISOString());

      const nudgeCount = nudges?.length || 0;
      if (nudgeCount >= 3) continue;

      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      await sendText(
        client.phone,
        `Hey ${client.name || 'there'}! Reminder to fill your weekly check-in 💪\n\n${formUrl}`,
        true
      );
      nudged++;
    }

    return res.json({ ok: true, sent, nudged });
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
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day;
  return new Date(now.getFullYear(), now.getMonth(), diff);
}
