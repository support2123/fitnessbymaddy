const { supabase } = require('../lib/supabase');
const { sendTextMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['authorization'];
  if (cronSecret && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysSinceStart / 7) + 1;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      try {
        await sendTextMessage(client.phone,
          `📊 Week ${weekNo} Check-in Time!\n\n` +
          `Hey ${client.name || 'Champion'}! Time for your weekly progress update.\n\n` +
          `Fill your check-in here: ${checkinUrl}\n\n` +
          `Share your weight, measurements, and photos — this helps Maddy fine-tune your plan! 💪`
        );
        sent++;
      } catch (e) {
        errors++;
        console.error(`Failed to send checkin to ${client.id}:`, e.message);
      }
    }

    return res.status(200).json({ sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
