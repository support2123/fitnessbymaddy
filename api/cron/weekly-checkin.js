const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;

    for (const client of clients) {
      const weeksActive = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksActive < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksActive)
        .maybeSingle();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksActive}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${client.name || ''}! 📋 Week ${weeksActive} ka check-in time hai.\n\nYahan submit karo: ${checkinUrl}\n\nWeight, waist, photos aur compliance bharna hai. 5 min lagega!`
        : `Hey ${client.name || ''}! 📋 Time for your Week ${weeksActive} check-in.\n\nSubmit here: ${checkinUrl}\n\nWeight, waist, photos, and compliance — takes 5 minutes!`;

      await sendWhatsApp({ phone: client.phone, message: msg, templateName: 'weekly_checkin' });
      sent++;
    }

    await checkMissedCheckins(db);

    return res.status(200).json({ ok: true, sent, total_clients: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
