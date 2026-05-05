const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { checkMissedCheckins, detectMarket } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (error || !clients) {
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients) {
      const weeksElapsed = Math.floor(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      const weekNo = weeksElapsed + 1;

      // Skip if check-in already submitted for this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      await checkMissedCheckins(client.id, client.phone);

      const market = detectMarket(client.phone);
      const isHinglish = market === 'IN';
      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const body = isHinglish
        ? `Hey ${client.name || 'Champion'}! 📋 Week ${weekNo} check-in ka time aa gaya hai.\n\nForm yahan bharo: ${formUrl}\n\nWeight, waist, photos aur apna update share karo — Maddy iske basis pe tumhara next week ka plan banayegi.`
        : `Hey ${client.name || 'Champion'}! 📋 Time for your Week ${weekNo} check-in.\n\nFill it here: ${formUrl}\n\nShare your weight, waist, photos and update — Maddy will build your next week's plan based on this.`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body,
        params: [client.name || 'Champion', String(weekNo), formUrl]
      });

      sent++;
    }

    // Schedule nudges for +24h and +48h via storing in messages for the nudge cron
    return res.json({
      ok: true,
      total_clients: clients.length,
      sent,
      skipped
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
