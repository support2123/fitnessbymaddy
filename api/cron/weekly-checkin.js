const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { createEscalation } = require('../_lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all active clients
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const weekNo = calculateCurrentWeek(client.program_started_at);

      // Check if they already submitted this week's check-in
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastSubmittedWeek = recentCheckins?.[0]?.week_no || 0;
      if (weekNo - lastSubmittedWeek >= 3) {
        await createEscalation(client.phone, 'consecutive_missed_checkins',
          `Client ${client.name} missed ${weekNo - lastSubmittedWeek - 1} consecutive check-ins`);
        escalated++;
      }

      // Send check-in form link
      const checkinUrl = `${process.env.APP_URL || 'https://fitnessbymaddy.com'}/checkin?c=${client.id}&w=${weekNo}`;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);
      sent++;
    }

    // Schedule nudges for non-responders (handled by nudge-dropped cron)
    return res.status(200).json({ success: true, sent, escalated, total_clients: clients.length });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startDate) {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, diffWeeks + 1);
}
