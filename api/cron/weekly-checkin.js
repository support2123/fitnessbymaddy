const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  // Verify Vercel cron secret
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, lead_id')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', count: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        // Calculate current week number
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil(
          (Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
        );

        if (weekNo < 1) continue;

        // Check if checkin already submitted for this week
        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        // Check for missed checkins (escalation)
        await checkMissedCheckins(client.id);

        // Detect market from lead
        const { data: lead } = await supabase
          .from('leads')
          .select('market')
          .eq('id', client.lead_id)
          .single();

        const market = lead?.market || 'GLOBAL';
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        if (isHinglish(market)) {
          await sendTemplate(client.phone, 'weekly_checkin_hi', [
            client.name || 'there',
            String(weekNo),
            checkinUrl
          ]);
        } else {
          await sendTemplate(client.phone, 'weekly_checkin_en', [
            client.name || 'there',
            String(weekNo),
            checkinUrl
          ]);
        }

        sent++;
      } catch (clientErr) {
        console.error(`Checkin send failed for ${client.id}:`, clientErr.message);
        errors++;
      }
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      sent,
      errors,
      total: clients.length
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
