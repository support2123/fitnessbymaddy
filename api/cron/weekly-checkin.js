const { supabase } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { maskPhone, isHinglish } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const { data: lead } = await supabase
        .from('leads')
        .select('market')
        .eq('phone', client.phone)
        .single();

      const market = lead?.market || 'GLOBAL';

      if (isHinglish(market)) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 📋 Week ${weekNo} check-in time!\n\nApna progress yahan submit karo:\n${checkinUrl}\n\nWeight, waist, photos aur kaise feel kar rahe ho — sab bhar do. 💪`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 📋 Time for your Week ${weekNo} check-in!\n\nSubmit your progress here:\n${checkinUrl}\n\nWeight, waist, photos and how you're feeling — fill it all in. 💪`
        );
      }

      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} week=${weekNo}`);
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
