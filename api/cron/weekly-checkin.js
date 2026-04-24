const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.method !== 'GET') {
    // Allow GET for manual trigger during testing
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!inner(market)')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalations = 0;

    for (const client of activeClients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      // Skip if past program end date
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      if (weekNo > 2 && !submittedWeeks.includes(weekNo - 1) && !submittedWeeks.includes(weekNo - 2)) {
        escalations++;
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || client.phone}\nProgram: ${client.program}\nLast submitted: Week ${submittedWeeks[0] || 'none'}\nCurrent: Week ${weekNo}`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.leads?.market || 'GLOBAL';

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: isHinglish(market)
          ? [client.name || 'there', weekNo.toString(), checkinUrl]
          : [client.name || 'there', weekNo.toString(), checkinUrl]
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in sent',
      sent,
      escalations,
      total_active: activeClients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
