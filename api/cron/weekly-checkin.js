const { supabase } = require('../lib/supabase');
const { sendFreeform, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    let errors = 0;

    for (const client of activeClients) {
      try {
        const weekNo = calculateCurrentWeek(client.program_started_at);

        if (weekNo < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const isHinglish = market === 'IN';

        const message = isHinglish
          ? `Hey ${client.name || 'there'}! 💪\n\nWeek ${weekNo} check-in time! Apna progress share karo:\n\n${checkinUrl}\n\n5 min lagega — weight, waist, photos aur ek quick rating. Let's keep the momentum going! 🔥`
          : `Hey ${client.name || 'there'}! 💪\n\nIt's Week ${weekNo} check-in time! Share your progress:\n\n${checkinUrl}\n\nTakes 5 min — weight, waist, photos and a quick rating. Let's keep the momentum going! 🔥`;

        const result = await sendFreeform(client.phone, message);
        if (result.success) sent++;
        else errors++;

      } catch (err) {
        errors++;
        console.error(`Checkin send failed for client ${client.id}:`, err.message);
      }
    }

    return res.status(200).json({ sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
