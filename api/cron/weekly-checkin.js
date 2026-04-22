const { supabase } = require('../../lib/supabase');
const { sendWhatsApp, sendEscalation } = require('../../lib/whatsapp');
const { detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckinWeek = missedCheckins?.[0]?.week_no || 0;
      if (weekNo - lastCheckinWeek >= 3) {
        await sendEscalation(
          '2+ consecutive missed check-ins',
          client.phone,
          `Client ${client.name || 'unknown'} has missed ${weekNo - lastCheckinWeek - 1} consecutive check-ins`
        );
        escalated++;
      }

      const market = detectMarket(client.phone);
      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const msg = market === 'IN'
        ? `Hey ${client.name || ''}! Week ${weekNo} check-in time \u{1F4CB}\n\nForm yahan fill karo: ${formUrl}\n\nWeight, waist, compliance score, aur photos daalo. Ye progress track karne ke liye zaroori hai!`
        : `Hey ${client.name || ''}! Time for your Week ${weekNo} check-in \u{1F4CB}\n\nFill it here: ${formUrl}\n\nPlease update your weight, waist, compliance score, and photos. Essential for tracking progress!`;

      await sendWhatsApp({ phone: client.phone, message: msg });
      sent++;
    }

    return res.status(200).json({ status: 'ok', sent, skipped, escalated });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
