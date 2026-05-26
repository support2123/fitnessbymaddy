const { getSupabase } = require('../../lib/supabase');
const { sendWhatsAppForced } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ sent: 0, message: 'No active clients' });
    }

    let sent = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      await checkMissedCheckins(client.id);

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const hinglish = isHinglish(client.leads?.market || 'GLOBAL');

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Apna progress share karo:\n${checkinUrl}\n\nWeight, measurements, aur photos daalo. Yeh data tumhare next week ka plan decide karega!`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Share your progress:\n${checkinUrl}\n\nLog your weight, measurements, and photos. This data shapes your next week's plan!`;

      await sendWhatsAppForced(client.phone, msg, 'weekly_checkin');
      sent++;
    }

    return res.json({ sent, total_active: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
