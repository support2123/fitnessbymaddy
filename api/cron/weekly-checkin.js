const { supabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Verify cron secret (Vercel sets this header)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      // Check if already submitted this week
      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastSubmittedWeek = recentCheckins && recentCheckins.length > 0
        ? recentCheckins[0].week_no
        : 0;

      if (currentWeek - lastSubmittedWeek >= 3) {
        await notifyMaddy(
          `MISSED CHECK-INS: ${client.name || maskPhone(client.phone)} has missed ${currentWeek - lastSubmittedWeek - 1} consecutive check-ins (last: W${lastSubmittedWeek}, current: W${currentWeek}). Program: ${client.program}`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl
      ]);
      sent++;
    }

    console.log(`Weekly check-in cron: sent=${sent}, escalated=${escalated}`);
    return res.status(200).json({ sent, escalated, total: activeClients.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
