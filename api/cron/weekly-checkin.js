const { supabase } = require('../_lib/supabase');
const { sendText } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { escalate } = require('../_lib/escalation');

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
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const { data: missedCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
        const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

        if (consecutiveMissed >= 2) {
          await escalate(
            '2 consecutive missed check-ins',
            client.phone,
            `Client: ${client.name || 'Unknown'}, Last check-in: Week ${lastSubmittedWeek}`
          );
        }

        const formLink = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = require('../_lib/market').detectMarket(client.phone);

        let msg;
        if (isHinglish(market)) {
          msg = `Hey ${client.name || 'Champion'}! 💪\n\n` +
            `Week ${weekNo} check-in time! Apna progress update karo:\n\n` +
            `📝 ${formLink}\n\n` +
            `Weight, waist, photos aur energy level — sab bharr do. ` +
            `Isse Maddy tumhara next week ka plan aur better bana payegi! 🔥`;
        } else {
          msg = `Hey ${client.name || 'Champion'}! 💪\n\n` +
            `Time for your Week ${weekNo} check-in!\n\n` +
            `📝 ${formLink}\n\n` +
            `Update your weight, waist, photos & energy level. ` +
            `This helps Maddy optimize your next week's plan! 🔥`;
        }

        await sendText(client.phone, msg);
        sent++;
      } catch (clientErr) {
        console.error(`Check-in send failed for client ${client.id}:`, clientErr.message);
        errors++;
      }
    }

    return res.status(200).json({ ok: true, sent, errors, total: activeClients.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
