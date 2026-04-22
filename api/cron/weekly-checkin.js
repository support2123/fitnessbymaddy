const { supabase } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendText(client.phone,
        `Hey ${client.name || 'there'}! 📋 Time for your Week ${weekNo} check-in!\n\n` +
        `Fill it out here: ${checkinUrl}\n\n` +
        `It takes 2 minutes and helps us keep your program on track 💪`
      );
      sent++;

      await supabase.from('nudges').insert({
        client_id: client.id,
        nudge_type: `checkin_week_${weekNo}`,
        sent_at: new Date().toISOString()
      });

      await scheduleFollowUpNudges(client, weekNo, checkinUrl);
      await checkMissedCheckins(client.id, client.phone);
    }

    return res.status(200).json({ message: `Sent ${sent} check-in reminders` });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

async function scheduleFollowUpNudges(client, weekNo, checkinUrl) {
  const { data: existingNudge24 } = await supabase
    .from('nudges')
    .select('id')
    .eq('client_id', client.id)
    .eq('nudge_type', `checkin_24h_week_${weekNo}`)
    .maybeSingle();

  if (!existingNudge24) {
    await supabase.from('nudges').insert({
      client_id: client.id,
      nudge_type: `checkin_24h_week_${weekNo}_scheduled`
    });
  }
}
