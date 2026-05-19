const { supabase } = require('../_lib/supabase');
const { sendText, checkRateLimit } = require('../_lib/whatsapp');
const { notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;
    const escalations = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) {
        skipped++;
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) {
        skipped++;
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      if (currentWeek - lastCheckinWeek >= 3) {
        escalations.push(client);
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const msg = `Hey ${client.name || 'there'}! 💪 It's check-in time (Week ${currentWeek}).\n\nFill out your weekly check-in here:\n${checkinUrl}\n\nShare your weight, measurements, and progress photos so we can keep optimizing your program!`;

      await sendText(client.phone, msg);
      sent++;
    }

    for (const client of escalations) {
      await notifyMaddy(
        '2+ consecutive missed check-ins',
        `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nPlease follow up manually.`
      );
    }

    console.log(`[WeeklyCheckin] Sent: ${sent}, Skipped: ${skipped}, Escalations: ${escalations.length}`);

    return res.status(200).json({
      success: true,
      sent,
      skipped,
      escalations: escalations.length,
    });
  } catch (error) {
    console.error('[WeeklyCheckin Error]', error.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
