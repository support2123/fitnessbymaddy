const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients?.length) {
      return res.status(200).json({ message: 'No active clients', count: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: lastTwoWeeks } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwoWeeks && lastTwoWeeks.length === 0 && weekNo >= 3) {
        await escalateToMaddy(
          client.phone,
          '2_consecutive_missed_checkins',
          `${client.name || 'Client'} has not submitted any check-ins (Week ${weekNo})`,
          client.id,
          null
        );
        escalated++;
      } else if (lastTwoWeeks && lastTwoWeeks.length > 0) {
        const latest = lastTwoWeeks[0].week_no;
        if (weekNo - latest >= 2) {
          await escalateToMaddy(
            client.phone,
            '2_consecutive_missed_checkins',
            `${client.name || 'Client'} missed check-ins for weeks ${latest + 1}-${weekNo}`,
            client.id,
            null
          );
          escalated++;
        }
      }

      const market = detectMarket(client.phone);
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      let msg;
      if (market === 'IN') {
        msg = `Hey ${client.name || ''} 👋 Week ${weekNo} ka check-in time hai!\n\n` +
          `📝 Form fill karo: ${checkinUrl}\n\n` +
          `Weight, waist measurement, aur 3 photos chahiye. 5 min lagega bas!`;
      } else {
        msg = `Hey ${client.name || ''} 👋 It's Week ${weekNo} check-in time!\n\n` +
          `📝 Fill your form: ${checkinUrl}\n\n` +
          `We need your weight, waist measurement, and 3 photos. Takes just 5 mins!`;
      }

      await sendWhatsApp(client.phone, msg, 'weekly_checkin');
      sent++;
    }

    return res.status(200).json({
      success: true,
      total_clients: activeClients.length,
      checkins_sent: sent,
      escalations: escalated
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
