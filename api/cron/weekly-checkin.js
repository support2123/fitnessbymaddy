const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
        const weekNo = calculateWeekNo(client.program_started_at);
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const market = detectMarketFromPhone(client.phone);
        const message = market === 'IN'
          ? `Hey ${client.name || 'there'}! 📊 Week ${weekNo} check-in time!\n\nForm yahan fill karo (2 min):\n${checkinUrl}\n\nWeight, measurements, aur photos daalo — toh hum tera next week plan bana sakein 💪`
          : `Hey ${client.name || 'there'}! 📊 Time for your Week ${weekNo} check-in!\n\nFill the form here (2 min):\n${checkinUrl}\n\nWeight, measurements & photos — so we can build your next week's plan 💪`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          body: message,
          params: [client.name || 'there', String(weekNo), checkinUrl]
        });

        sent++;
      } catch (err) {
        console.error(`Checkin send error for client:`, err.message);
        errors++;
      }
    }

    return res.status(200).json({ message: 'Weekly check-ins sent', sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, diffWeeks + 1);
}

function detectMarketFromPhone(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  return 'GLOBAL';
}
