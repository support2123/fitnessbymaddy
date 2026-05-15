const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        // Calculate current week number
        const started = new Date(client.program_started_at);
        const weekNo = Math.ceil((Date.now() - started.getTime()) / (7 * 24 * 60 * 60 * 1000));

        // Check if program has ended
        if (client.program_ends_at && new Date(client.program_ends_at) < new Date()) {
          await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
          continue;
        }

        // Check for missed check-ins and escalate if needed
        await checkMissedCheckins(client.id);

        // Check if they already submitted this week
        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        const msg = hinglish
          ? [client.name || 'there', String(weekNo), checkinUrl]
          : [client.name || 'there', String(weekNo), checkinUrl];

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          bodyValues: msg,
        });

        sent++;
      } catch (err) {
        console.error(`Checkin send failed for client ${client.id}:`, err.message);
        errors++;
      }
    }

    return res.status(200).json({ ok: true, sent, errors, total: clients.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
