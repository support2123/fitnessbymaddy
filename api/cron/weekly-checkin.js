const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
      const weekNo = calculateWeekNo(client.program_started_at);

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { data: missedWeeks } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckinWeek = missedWeeks?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastCheckinWeek - 1;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          message: `${client.name} missed ${consecutiveMissed} check-ins (Week ${weekNo})`,
        });
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = client.phone.startsWith('+91') ? 'IN' : 'GLOBAL';

      const params = market === 'IN'
        ? [client.name || 'there', `Week ${weekNo} ka check-in time! 💪\n\n📋 Form: ${checkinUrl}\n\nWeight, waist, photos aur feedback share karo.`]
        : [client.name || 'there', `Week ${weekNo} check-in time! 💪\n\n📋 Form: ${checkinUrl}\n\nShare your weight, waist, photos and feedback.`];

      await sendWhatsApp(client.phone, 'weekly_checkin', params);
      sent++;
    }

    return res.status(200).json({ sent, escalated, total_clients: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}
