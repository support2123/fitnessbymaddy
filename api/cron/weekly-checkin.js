const { supabase } = require('../_lib/supabase');
const { sendText } = require('../_lib/whatsapp');
const { notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
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
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / 86400000);
        const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) continue;

        const { data: missedCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const lastCheckedWeek = missedCheckins?.[0]?.week_no || 0;
        const consecutiveMissed = weekNo - lastCheckedWeek - 1;

        if (consecutiveMissed >= 2) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nMissed weeks: ${consecutiveMissed}`
          );
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const msg = `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in.\n\nFill it out here (takes 2 mins):\n${checkinUrl}\n\nInclude your weight, waist measurement, and 3 progress photos for best results!`;

        await sendText(client.phone, msg);
        sent++;
      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({
      message: `Weekly check-in sent to ${sent} clients`,
      sent,
      total: activeClients.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
