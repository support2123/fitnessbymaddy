const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_ends_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    const baseUrl = process.env.VERCEL_URL || 'fitnessbymaddy.com';

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://${baseUrl}/checkin?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, {
        text: `Hey ${client.name || 'there'}! 📊 Time for your Week ${weekNo} check-in.\n\n📝 Fill this out: ${checkinUrl}\n\nWeight, waist, photos — takes 2 mins. Let's track your progress! 💪`,
        isClient: true
      });

      sent++;
    }

    return res.json({ ok: true, sent });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
